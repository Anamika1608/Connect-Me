import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Video, VideoOff } from 'lucide-react';
import * as mediasoupClient from 'mediasoup-client'

export default function Meeting() {
    const [socketId, setSocketId] = useState('');
    const [stream, setStream] = useState(null);
    const [isDeviceReady, setIsDeviceReady] = useState(false);

    const roomName = window.location.pathname.split('/')[2]

    let isProducer = false
    let audioProducer
    let videoProducer
    let consumer
    let device = null
    let producerTransport = null
    let consumerTransports = []
    let rtpCapabilities = null
    let mainStream = null

    const videoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const socketRef = useRef(null);

    let params = {
        encodings: [
            {
                rid: 'r0',
                maxBitrate: 100000,
                scalabilityMode: 'S1T3',
            },
            {
                rid: 'r1',
                maxBitrate: 300000,
                scalabilityMode: 'S1T3',
            },
            {
                rid: 'r2',
                maxBitrate: 900000,
                scalabilityMode: 'S1T3',
            },
        ],
        codecOptions: {
            videoGoogleStartBitrate: 1000
        }
    }

    let audioParams;
    let videoParams = { params };
    let consumingTransports = [];

    const streamSuccess = (stream) => {
        localVideo.srcObject = stream

        audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
        videoParams = { track: stream.getVideoTracks()[0], ...videoParams };

        joinRoom()
    }

    const joinRoom = () => {
        socketRef.current.emit('joinRoom', { roomName }, (data) => {

            console.log(`router rtpc - ${data.rtpCapabilities}`)
            rtpCapabilities = data.rtpCapabilities
            createDevice()
        })
    }

    const getLocalStream = () => {
        navigator.mediaDevices.getUserMedia({
            audio: true,
            video: {
                width: {
                    min: 640,
                    max: 1920,
                },
                height: {
                    min: 400,
                    max: 1080,
                }
            }
        })
            .then(streamSuccess)
            .catch(error => {
                console.log(error.message)
            })
    }

    const goConsume = () => {
        goConnect(false)
    }

    const goConnect = (producerOrConsumer) => {
        console.log("value in go connect", producerOrConsumer);

        isProducer = producerOrConsumer

        device === null ? createDevice() : goCreateTransport();
    }

    const goCreateTransport = () => {
        console.log("in goCreateTransport", isProducer)
        isProducer ? createSendTransport() : createRecvTransport()
    }

    const getRtpCapabilities = async () => {
        return new Promise((resolve, reject) => {
            socketRef.current.emit('createRoom', (data) => {
                console.log('Router RTP Capabilities:', data.rtpCapabilities);
                rtpCapabilities = data.rtpCapabilities;
                resolve(data.rtpCapabilities);
            });
        });
    }

    const getProducers = () => {
        socketRef.current.emit('getProducers', producerIds => {
            console.log(producerIds)
            // for each of the producer create a consumer
            // producerIds.forEach(id => signalNewConsumerTransport(id))
            producerIds.forEach(signalNewConsumerTransport)
        })
    }

    const createDevice = async () => {
        try {
            console.log("in creating device fn")
            if (!rtpCapabilities) rtpCapabilities = await getRtpCapabilities();
            console.log("values from the create device function", rtpCapabilities);

            const newDevice = new mediasoupClient.Device();

            await newDevice.load({
                routerRtpCapabilities: rtpCapabilities
            });

            console.log('Device created with RTP Capabilities:', newDevice.rtpCapabilities);
            device = newDevice
            setIsDeviceReady(true);

            createSendTransport();

        } catch (error) {
            console.error('Failed to create device:', error);
            if (error.name === 'UnsupportedError') {
                console.warn('Browser not supported');
            }
        }
    };

    const createSendTransport = async () => {

        socketRef.current.emit('createWebRtcTransport', { consumer: false }, ({ params }) => {
            if (params.error) {
                console.error(params.error);
                return;
            }

            console.log('device in createSendTrasnport', device)

            const transport = device.createSendTransport(params);

            transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    await socketRef.current.emit('transport-connect', {
                        dtlsParameters,
                    });
                    callback();
                } catch (error) {
                    errback(error);
                }
            });

            transport.on('produce', async (parameters, callback, errback) => {
                try {
                    console.log(parameters)
                    await socketRef.current.emit('transport-produce', {
                        kind: parameters.kind,
                        rtpParameters: parameters.rtpParameters,
                        appData: parameters.appData,
                    }, ({ id, producersExist }) => {
                        callback({ id });

                        // is producer exist - join room 

                        if (producersExist) getProducers()
                    });
                } catch (error) {
                    errback(error);
                }
            });

            producerTransport = transport
            connectSendTransport();
        });

    };

    const connectSendTransport = async () => {
        if (!producerTransport) {
            console.error('Producer transport not initialized');
            return;
        }

        try {
            console.log("in connection with send transport");
            audioProducer = await producerTransport.produce(audioParams);
            videoProducer = await producerTransport.produce(videoParams);

            audioProducer.on('trackended', () => {
                console.log('audio track ended')

                // close audio track
            })

            audioProducer.on('transportclose', () => {
                console.log('audio transport ended')

                // close audio track
            })

            videoProducer.on('trackended', () => {
                console.log('video track ended')

                // close video track
            })

            videoProducer.on('transportclose', () => {
                console.log('video transport ended')

                // close video track
            })
        } catch (error) {
            console.error('Failed to produce:', error);
        }
    };

    const signalNewConsumerTransport = async (remoteProducerId) => {

        if (consumingTransports.includes(remoteProducerId)) return;
        consumingTransports.push(remoteProducerId);

        await socketRef.current.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
            if (params.error) {
                console.log(params.error)
                return
            }

            console.log(params)

            const transport = device.createRecvTransport(params)

            transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    // Signal local DTLS parameters to the server side transport
                    // see server's socket.on('transport-recv-connect', ...)
                    await socketRef.current.emit('transport-recv-connect', {
                        dtlsParameters,
                    })

                    // Tell the transport that parameters were transmitted.
                    callback()
                } catch (error) {
                    // Tell the transport that something was wrong
                    errback(error)
                }
            })

            const consumerTransport = transport
            connectRecvTransport(consumerTransport, remoteProducerId, params.id)
        })
    }

    const connectRecvTransport = async (consumerTransport, remoteProducerId, serverConsumerTransportId) => {
        await socketRef.current.emit('consume', {
            rtpCapabilities: device.rtpCapabilities,
            remoteProducerId,
            serverConsumerTransportId,
        }, async ({ params }) => {
            if (params.error) {
                console.log(`error in connecting receiving transport - ${JSON.stringify(params)}`);
                console.log('Cannot Consume');
                return;
            }

            console.log(params);
            const consumer = await consumerTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters
            });

            consumerTransports = [
                ...consumerTransports,
                {
                    consumerTransport,
                    serverConsumerTransportId: params.id,
                    producerId: remoteProducerId,
                    consumer,
                },
            ]

            const newElem = document.createElement('div')
            newElem.setAttribute('id', `td-${remoteProducerId}`)

            if (params.kind == 'audio') {
                //append to the audio container
                newElem.innerHTML = '<audio id="' + remoteProducerId + '" autoplay></audio>'
            } else {
                //append to the video container
                newElem.setAttribute('class', 'remoteVideo')
                newElem.innerHTML = '<video id="' + remoteProducerId + '" autoplay class="video" ></video>'
            }

            videoContainer.appendChild(newElem)

            // destructure and retrieve the video track from the producer
            const { track } = consumer

            document.getElementById(remoteProducerId).srcObject = new MediaStream([track])

            // the server consumer started with media paused
            // so we need to inform the server to resume
            socketRef.current.emit('consumer-resume', { serverConsumerId: params.serverConsumerId })

            // if (remoteVideoRef.current) {
            //     // get element by remoteProduceerId and give that value = new MediaStream([track]);
            //     remoteVideoRef.current.srcObject = new MediaStream([track]);
            // }

        });
    };

    useEffect(() => {
        if (!socketRef.current) {
            console.log("Initializing socket connection...");
            socketRef.current = io("http://localhost:8000/mediasoup", {
                transports: ['websocket'],
                upgrade: false,
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });

            socketRef.current.on('connect', () => {
                console.log("Socket connected");
            });

            socketRef.current.on('connection-success', ({ socketId, existsProducer }) => {
                console.log("MediaSoup connection success:", socketId);
                console.log("exists producer - ", existsProducer)
                setSocketId(socketId);
                getLocalStream()
            });

            // server informs the client of a new producer just joined
            socketRef.current.on('new-producer', ({ producerId }) => signalNewConsumerTransport(producerId))

            socketRef.current.on('producer-closed', ({ remoteProducerId }) => {
                // server notification is received when a producer is closed
                // we need to close the client-side consumer and associated transport
                const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId)
                producerToClose.consumerTransport.close()
                producerToClose.consumer.close()

                // remove the consumer transport from the list
                consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId)

                // remove the video div element
                videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
            })

            socketRef.current.on('connect_error', (error) => {
                console.error("Connection error:", error);
            });

            socketRef.current.on('disconnect', (reason) => {
                console.log("Socket disconnected:", reason);
            });
        }

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            if (socketRef.current) {
                console.log("Cleaning up socket connection...");
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, []);

    return (
        <div className="flex flex-col h-screen bg-gray-900">
            <div className="relative flex-1 p-6">
                <div className="grid grid-cols-2 gap-6">
                    <div className="relative">
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            className="w-full h-[400px] object-cover rounded-lg"
                            style={{ transform: 'scaleX(-1)' }}
                        />
                        {/* <div className="absolute bottom-4 right-4">
                            <button
                                onClick={getLocalStream}
                                className="p-4 bg-gray-800 hover:bg-gray-700 text-white rounded-full shadow-lg transition-colors"
                            >
                                {isVideoOn ? (
                                    <Video className="w-6 h-6" />
                                ) : (
                                    <VideoOff className="w-6 h-6" />
                                )}
                            </button>
                        </div> */}
                    </div>

                    <div className="relative">
                        <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                            className="w-full h-[400px] object-cover rounded-lg"
                        />
                    </div>
                </div>

                <div className="mt-6 flex gap-2 justify-center">

                    <button
                        onClick={getLocalStream}
                        className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Produce
                    </button>
                    <button
                        onClick={() => goConsume(false)}
                        className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Consume
                    </button>
                </div>
            </div>
        </div>
    );
};


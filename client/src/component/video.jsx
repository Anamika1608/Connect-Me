import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Video, VideoOff, Mic, MicOff, LogOut, Monitor, StopCircle } from 'lucide-react';
import * as mediasoupClient from 'mediasoup-client'

export default function Meeting() {
    const [stream, setStream] = useState(null);
    const [socketId, setSocketId] = useState('');
    const [remoteStreams, setRemoteStreams] = useState(new Map());
    const [isDeviceReady, setIsDeviceReady] = useState(false);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [screenShareStream, setScreenShareStream] = useState(null);
    const [deviceValue, setDeviceValue] = useState(null);

    let device = null;

    const localVideoRef = useRef(null);
    const screenShareRef = useRef(null);
    const socketRef = useRef(null);

    const roomName = window.location.pathname.split('/')[2];

    let isProducer = false;
    let audioProducer;
    let videoProducer;
    let screenShareProducer;
    let screenShareTransport;
    let consumer;
    let producerTransport = null;
    let consumerTransports = [];
    let rtpCapabilities = null;
    let mainStream = null;


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


    const joinRoom = () => {
        socketRef.current.emit('joinRoom', { roomName }, (data) => {
            console.log("in joining room function")
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

    const toggleVideo = () => {
        if (localVideoRef.current?.srcObject) {
            const videoTrack = localVideoRef.current.srcObject.getVideoTracks()[0];
            videoTrack.enabled = !videoTrack.enabled;
            setIsVideoEnabled(videoTrack.enabled);
        }
    };

    const leaveRoom = () => {
        if (localVideoRef.current?.srcObject) {
            localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
        }
        if (socketRef.current) {
            socketRef.current.disconnect();
        }
        window.location.href = '/';
    };

    const toggleAudio = () => {
        if (localVideoRef.current?.srcObject) {
            const audioTrack = localVideoRef.current.srcObject.getAudioTracks()[0];
            audioTrack.enabled = !audioTrack.enabled;
            setIsAudioEnabled(audioTrack.enabled);
        }
    };

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
            setDeviceValue(newDevice)
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
                        isScreenShare: false 
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

                        if (producersExist) {
                            getProducers()
                        } else {
                            console.log("producers do not exists")
                        }
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

        console.log("remote producer id from create consumer", remoteProducerId)

        if (consumingTransports.includes(remoteProducerId)) return;
        consumingTransports.push(remoteProducerId);

        await socketRef.current.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
            if (params.error) {
                console.log(params.error)
                return
            }

            console.log('params in create consumer transport ', params)

            const transport = device.createRecvTransport(params)

            transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    // Signal local DTLS parameters to the server side transport
                    // see server's socket.on('transport-recv-connect', ...)
                    await socketRef.current.emit('transport-recv-connect', {
                        dtlsParameters,
                        serverConsumerTransportId: params.id,
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
                return;
            }

            try {
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
                ];

                const { track } = consumer;
                const stream = new MediaStream([track]);

                // Handle different types of streams
                if (params.kind === 'video') {
                    setRemoteStreams(prev => {
                        const newStreams = new Map(prev);
                        newStreams.set(remoteProducerId, {
                            stream,
                            type: params.type || 'video' // 'video' or 'screen'
                        });
                        return newStreams;
                    });
                }

                socketRef.current.emit('consumer-resume', {
                    serverConsumerId: params.serverConsumerId
                });
            } catch (error) {
                console.error('Error in consume transport:', error);
            }
        });
    };

    // Update the streamSuccess function
    const streamSuccess = (stream) => {
        setStream(stream);
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
        }

        audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
        videoParams = { track: stream.getVideoTracks()[0], ...videoParams };

        joinRoom();
    };

    const startScreenShare = async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
    
            setScreenShareStream(stream);
            setIsScreenSharing(true);
    
            if (screenShareRef.current) {
                screenShareRef.current.srcObject = stream;
            }
    
            if (!deviceValue) {
                console.error('MediaSoup device not initialized');
                return;
            }
    
            // Emit startScreenShare event
            socketRef.current.emit('startScreenShare', { roomName }, async ({ params }) => {
                if (params.error) {
                    console.error(params.error);
                    return;
                }
    
                screenShareTransport = deviceValue.createSendTransport(params);
    
                screenShareTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                    try {
                        await socketRef.current.emit('transport-connect', {
                            dtlsParameters,
                            isScreenShare: true
                        });
                        callback();
                    } catch (error) {
                        errback(error);
                    }
                });
    
                screenShareTransport.on('produce', async (parameters, callback, errback) => {
                    try {
                        // Ensure unique MID for screen share
                        if (!parameters.rtpParameters.mid) {
                            parameters.rtpParameters.mid = `screen_${Date.now()}`;
                        }
    
                        await socketRef.current.emit('transport-produce', {
                            kind: parameters.kind,
                            rtpParameters: parameters.rtpParameters,
                            appData: parameters.appData,
                            isScreenShare: true
                        }, ({ id }) => {
                            callback({ id });
                            screenShareProducer = id;
                        });
                    } catch (error) {
                        errback(error);
                    }
                });
    
                // Produce screen share track
                await screenShareTransport.produce({
                    track: stream.getVideoTracks()[0],
                    encodings: [
                        { maxBitrate: 100000, scaleResolutionDownBy: 2 },
                        { maxBitrate: 300000, scaleResolutionDownBy: 1 }
                    ],
                    appData: { mediaType: 'screen' }
                });
            });
    
            // Handle stream end
            stream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };
        } catch (error) {
            console.error('Error starting screen share:', error);
            setIsScreenSharing(false);
        }
    };

    const stopScreenShare = () => {
        if (screenShareStream) {
            screenShareStream.getTracks().forEach(track => track.stop());
            setScreenShareStream(null);
        }

        if (screenShareProducer) {
            socketRef.current.emit('stopScreenShare', { producerId: screenShareProducer });
            screenShareProducer = null;
        }

        if (screenShareTransport) {
            screenShareTransport.close();
            screenShareTransport = null;
        }

        setIsScreenSharing(false);
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

                setRemoteStreams(prev => {
                    const newStreams = new Map(prev);
                    newStreams.delete(remoteProducerId);
                    return newStreams;
                });

            })

            socketRef.current.on('new-screen-share', async ({ peerId, producerId }) => {
                console.log('New screen share detected:', producerId);
                await signalNewConsumerTransport(producerId);
            });

            socketRef.current.on('screen-share-ended', ({ peerId, producerId }) => {
                console.log('Screen share ended:', producerId);
                const producerToClose = consumerTransports.find(
                    transportData => transportData.producerId === producerId
                );
                if (producerToClose) {
                    producerToClose.consumerTransport.close();
                    producerToClose.consumer.close();
                    consumerTransports = consumerTransports.filter(
                        transportData => transportData.producerId !== producerId
                    );
                }

                setRemoteStreams(prev => {
                    const newStreams = new Map(prev);
                    newStreams.delete(producerId);
                    return newStreams;
                });
            });

            socketRef.current.on('connect_error', (error) => {
                console.error("Connection error:", error);
            });

            socketRef.current.on('disconnect', (reason) => {
                console.log("Socket disconnected:", reason);
            });
        }

        return () => {
            if (screenShareStream) {
                screenShareStream.getTracks().forEach(track => track.stop());
            }
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, []);

    return (
        <div className="w-full min-h-screen bg-gray-900 p-4">
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-4 relative aspect-video bg-gray-800 rounded-lg overflow-hidden">
                        <video
                            ref={localVideoRef}
                            autoPlay
                            playsInline
                            className="w-full h-full object-cover transform scale-x-[-1]"
                        />
                        <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-1 rounded text-white text-sm">
                            You
                        </div>
                        <div className="absolute bottom-2 right-2 flex gap-2">
                            <button
                                onClick={toggleAudio}
                                className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 transition-colors"
                            >
                                {isAudioEnabled ? (
                                    <Mic className="w-5 h-5 text-white" />
                                ) : (
                                    <MicOff className="w-5 h-5 text-red-500" />
                                )}
                            </button>
                            <button
                                onClick={toggleVideo}
                                className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 transition-colors"
                            >
                                {isVideoEnabled ? (
                                    <Video className="w-5 h-5 text-white" />
                                ) : (
                                    <VideoOff className="w-5 h-5 text-red-500" />
                                )}
                            </button>
                            <button
                                onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                                className="p-2 rounded-full bg-gray-800 hover:bg-gray-700 transition-colors"
                            >
                                {isScreenSharing ? (
                                    <StopCircle className="w-5 h-5 text-red-500" />
                                ) : (
                                    <Monitor className="w-5 h-5 text-white" />
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="col-span-8">
                        <div className="grid grid-cols-2 gap-4">
                            {Array.from(remoteStreams).map(([producerId, { stream, type }]) => (
                                <div
                                    key={producerId}
                                    className={`relative aspect-video bg-gray-800 rounded-lg overflow-hidden ${type === 'screen' ? 'col-span-2' : ''
                                        }`}
                                >
                                    <video
                                        autoPlay
                                        playsInline
                                        className={`w-full h-full ${type === 'screen' ? 'object-contain' : 'object-cover transform scale-x-[-1]'
                                            }`}
                                        ref={el => {
                                            if (el) el.srcObject = stream;
                                        }}
                                    />
                                    {type === 'screen' && (
                                        <div className="absolute top-2 left-2 bg-black/50 px-2 py-1 rounded text-white text-sm">
                                            Screen Share
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="fixed bottom-4 left-1/2 -translate-x-1/2">
                    <button
                        onClick={leaveRoom}
                        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                    >
                        <LogOut className="w-5 h-5" />
                        Leave Room
                    </button>
                </div>
            </div>
        </div>
    );
};
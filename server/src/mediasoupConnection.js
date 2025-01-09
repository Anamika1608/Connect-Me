import mediasoup from "mediasoup";

let worker;
let rooms = {};
let peers = {}
let transports = []
let producers = []
let consumers = []

const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 2000,
        rtcMaxPort: 2020,
    })
    console.log(`worker pid ${worker.pid}`)

    worker.on('died', error => {
        // This implies something serious happened, so kill the application
        console.error('mediasoup worker has died')
        setTimeout(() => process.exit(1), 2000) // exit in 2 seconds
    })

    return worker
}

worker = await createWorker()

const mediaCodecs = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
    },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000,
        },
    },
]

const createWebRtcTransport = async (router, socketId) => {
    return new Promise(async (resolve, reject) => {
        try {
            const webRtcTransport_options = {
                listenIps: [
                    {
                        ip: '0.0.0.0',
                        announcedIp: '192.168.1.14',
                    }
                ],
                enableUdp: true,
                enableTcp: true,
                preferUdp: true,
            }

            let transport = await router.createWebRtcTransport(webRtcTransport_options);
            console.log(`Transport created. Transport ID: ${transport.id}, Socket ID: ${socketId}`);

            transport.on('dtlsstatechange', dtlsState => {
                if (dtlsState === 'closed') {
                    transport.close();
                }
            });

            transport.on('close', () => {
                console.log(`Transport closed for Socket ID: ${socketId}`);
            });

            resolve(transport);

        } catch (error) {
            reject(error);
        }
    });
};


const getTransport = (socketId) => {
    const [producerTransport] = transports.filter(transport => transport.socketId === socketId && !transport.consumer)
    return producerTransport.transport
}

const createRoom = async (roomName, socketId) => {
    // worker.createRouter(options)
    // options = { mediaCodecs, appData }
    // mediaCodecs -> defined above
    // appData -> custom application data - we are not supplying any
    // none of the two are required
    let router1
    let peers = []
    if (rooms[roomName]) {
        router1 = rooms[roomName].router
        peers = rooms[roomName].peers || []
    } else {
        router1 = await worker.createRouter({ mediaCodecs, })
    }

    console.log(`Router ID: ${router1.id}`, peers.length)

    rooms[roomName] = {
        router: router1,
        peers: [...peers, socketId],
    }

    return router1
}

const mediaSoupSocketConnection = (connections) => {

    connections.on('connection', async socket => {
        console.log('MediaSoup peer connected:', socket.id);

        socket.on('joinRoom', async ({ roomName }, callback) => {
            // create Router if it does not exist
            // const router1 = rooms[roomName] && rooms[roomName].get('data').router || await createRoom(roomName, socket.id)
            const router1 = await createRoom(roomName, socket.id)

            peers[socket.id] = {
                socket,
                roomName,           // Name for the Router this Peer joined
                transports: [],
                producers: [],
                consumers: [],
                peerDetails: {
                    name: '',
                    isAdmin: false,   // Is this Peer the Admin?
                }
            }

            // get Router RTP Capabilities
            const rtpCapabilities = router1.rtpCapabilities

            // call callback from the client and send back the rtpCapabilities
            callback({ rtpCapabilities })
        })

        const addTransport = (transport, roomName, consumer) => {

            transports = [
                ...transports,
                { socketId: socket.id, transport, roomName, consumer, }
            ]

            peers[socket.id] = {
                ...peers[socket.id],
                transports: [
                    ...peers[socket.id].transports,
                    transport.id,
                ]
            }
        }

        const addProducer = (producer, roomName) => {
            producers = [
                ...producers,
                { socketId: socket.id, producer, roomName, }
            ]

            peers[socket.id] = {
                ...peers[socket.id],
                producers: [
                    ...peers[socket.id].producers,
                    producer.id,
                ]
            }
        }

        const addConsumer = (consumer, roomName) => {
            // add the consumer to the consumers list
            consumers = [
                ...consumers,
                { socketId: socket.id, consumer, roomName, }
            ]

            // add the consumer id to the peers list
            peers[socket.id] = {
                ...peers[socket.id],
                consumers: [
                    ...peers[socket.id].consumers,
                    consumer.id,
                ]
            }
        }

        socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
            // get Room Name from Peer's properties
            const roomName = peers[socket.id].roomName

            // get Router (Room) object this peer is in based on RoomName
            const router = rooms[roomName].router

            console.log("in create webrtc transport event")

            createWebRtcTransport(router, socket.id).then(
                transport => {
                    callback({
                        params: {
                            id: transport.id,
                            iceParameters: transport.iceParameters,
                            iceCandidates: transport.iceCandidates,
                            dtlsParameters: transport.dtlsParameters,
                        }
                    })

                    // add transport to Peer's properties
                    addTransport(transport, roomName, consumer)
                },
                error => {
                    console.log(error)
                })
        })

        socket.on('transport-connect', async ({ dtlsParameters }) => {
            console.log('DTLS PARAMS... ', { dtlsParameters })
            getTransport(socket.id).connect({ dtlsParameters })
        })

        socket.on('getProducers', callback => {
            //return all producer transports
            const { roomName } = peers[socket.id]

            let producerList = []
            producers.forEach(producerData => {
                if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
                    const isScreenShare = screenShares.get(roomName)?.has(producerData.socketId);
                    producerList.push({
                        producerId: producerData.producer.id,
                        isScreenShare: !!isScreenShare
                    });
                }
            })

            // return the producer list back to the client
            callback(producerList)
        })

        socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
            // call produce based on the prameters from the client
            const producer = await getTransport(socket.id).produce({
                kind,
                rtpParameters,
            })

            // add producer to the producers array
            const { roomName } = peers[socket.id]

            addProducer(producer, roomName)

            informConsumers(roomName, socket.id, producer.id)

            console.log('Producer ID: ', producer.id, producer.kind)

            producer.on('transportclose', () => {
                console.log('transport for this producer closed ')
                producer.close()
            })

            // Send back to the client the Producer's id
            callback({
                id: producer.id,
                producersExist: producers.length > 1 ? true : false
            })
        })

        socket.on('transport-recv-connect', async ({ dtlsParameters, serverConsumerTransportId }) => {
            console.log(`DTLS PARAMS: ${dtlsParameters}`)
            // console.log('Transports array:', transports) // Debug log
            console.log('Looking for transport ID:', serverConsumerTransportId) // Debug log

            const transportData = transports.find(transportData =>
                transportData.consumer && transportData.transport.id == serverConsumerTransportId
            )

            if (!transportData) {
                console.error('Could not find consumer transport:', serverConsumerTransportId)
                console.error('Available transports:', transports.map(t => ({
                    id: t.transport.id,
                    consumer: t.consumer,
                    socketId: t.socketId
                })))
                return
            }

            const consumerTransport = transportData.transport
            // console.log("consumer transport",consumerTransport);
            await consumerTransport.connect({ dtlsParameters })
        })

        socket.on('consume', async ({ rtpCapabilities, remoteProducerId, serverConsumerTransportId }, callback) => {
            try {

                const { roomName } = peers[socket.id]
                const router = rooms[roomName].router
                let consumerTransport = transports.find(transportData => (
                    transportData.consumer && transportData.transport.id == serverConsumerTransportId
                )).transport

                // check if the router can consume the specified producer
                if (router.canConsume({
                    producerId: remoteProducerId,
                    rtpCapabilities
                })) {
                    // transport can now consume and return a consumer
                    const consumer = await consumerTransport.consume({
                        producerId: remoteProducerId,
                        rtpCapabilities,
                        paused: true,
                    })

                    consumer.on('transportclose', () => {
                        console.log('transport close from consumer')
                    })

                    consumer.on('producerclose', () => {
                        console.log('producer of consumer closed')
                        socket.emit('producer-closed', { remoteProducerId })

                        consumerTransport.close([])
                        transports = transports.filter(transportData => transportData.transport.id !== consumerTransport.id)
                        consumer.close()
                        consumers = consumers.filter(consumerData => consumerData.consumer.id !== consumer.id)
                    })

                    addConsumer(consumer, roomName)

                    // from the consumer extract the following params
                    // to send back to the Client
                    const params = {
                        id: consumer.id,
                        producerId: remoteProducerId,
                        kind: consumer.kind,
                        rtpParameters: consumer.rtpParameters,
                        serverConsumerId: consumer.id,
                    }

                    // send the parameters to the client
                    callback({ params })
                }
            } catch (error) {
                console.log(error.message)
                callback({
                    params: {
                        error: error
                    }
                })
            }
        })

        socket.on('consumer-resume', async ({ serverConsumerId }) => {
            console.log('consumer resume', serverConsumerId, socket.id)
            const { consumer } = consumers.find(consumerData => consumerData.consumer.id === serverConsumerId)
            if (consumer) console.log("got the consumer")
            await consumer.resume()
        })

        socket.emit('connection-success', {
            socketId: socket.id
        });

        socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    });
}

export default mediaSoupSocketConnection
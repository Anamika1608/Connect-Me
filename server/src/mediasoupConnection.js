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
                        ip: '0.0.0.0', // replace with relevant IP address
                        announcedIp: '192.168.1.5',
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

const getTransport = (socketId, isScreenShare = false) => {
    // Find the most recently created transport for the given socket ID and type
    const filteredTransports = transports.filter(transport =>
        transport.socketId === socketId &&
        !transport.consumer &&
        transport.isScreenShare === isScreenShare
    );

    // Get the last (most recent) transport
    return filteredTransports[filteredTransports.length - 1]?.transport;
};

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

const informConsumers = (roomName, socketId, id) => {
    console.log(`just joined, PrdoucerId ${id} ${roomName}, ${socketId}`)
    // A new producer just joined
    // let all consumers to consume this producer
    producers.forEach(producerData => {
        if (producerData.socketId !== socketId && producerData.roomName === roomName) {
            const producerSocket = peers[producerData.socketId].socket
            // use socket to send producer id to producer
            producerSocket.emit('new-producer', { producerId: id })
        }
    })
}

const mediaSoupSocketConnection = (connections) => {

    connections.on('connection', async socket => {
        console.log('MediaSoup peer connected:', socket.id);

        socket.emit('connection-success', {
            socketId: socket.id
        });

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

        const addTransport = (transport, roomName, consumer, isScreenShare = false) => {
            transports = [
                ...transports,
                {
                    socketId: socket.id,
                    transport,
                    roomName,
                    consumer,
                    isScreenShare
                }
            ];

            peers[socket.id] = {
                ...peers[socket.id],
                transports: [
                    ...peers[socket.id].transports,
                    transport.id,
                ]
            };
        };

        const addProducer = (producer, roomName, isScreenShare = false) => {
            producers = [
                ...producers,
                {
                    socketId: socket.id,
                    producer,
                    roomName,
                    isScreenShare
                }
            ];

            peers[socket.id] = {
                ...peers[socket.id],
                producers: [
                    ...peers[socket.id].producers,
                    producer.id,
                ]
            };
        };

        // inform peers about screen share
        const informPeersAboutScreenShare = (roomName, socketId, producerId) => {
            console.log("inside inform peers about screen share");
            rooms[roomName].peers.forEach(peerId => {
                if (peerId !== socketId) {
                    console.log("producer id - ", producerId);
                    console.log("room name", roomName);
                    console.log("socket id", socketId)
                    peers[peerId].socket.emit('new-screen-share', {
                        peerId: socketId,
                        producerId
                    });
                }
            });
        };

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

        socket.on('transport-connect', async ({ dtlsParameters, isScreenShare = false }) => {
            console.log('DTLS PARAMS... ', { dtlsParameters });
            const transport = getTransport(socket.id, isScreenShare);

            if (!transport) {
                console.error('No transport found for socket:', socket.id);
                return;
            }

            try {
                await transport.connect({ dtlsParameters });
            } catch (error) {
                console.error('Error connecting transport:', error);
            }
        });

        socket.on('getProducers', callback => {
            //return all producer transports
            const { roomName } = peers[socket.id]

            let producerList = []
            producers.forEach(producerData => {
                if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
                    producerList = [...producerList, producerData.producer.id]
                }
            })

            // return the producer list back to the client
            callback(producerList)
        })

        socket.on('transport-produce', async ({ kind, rtpParameters, appData, isScreenShare }, callback) => {
            try {
                // Generate a unique mid 
                if (rtpParameters.mid === undefined) {
                    rtpParameters.mid = `${kind}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                }

                const transport = getTransport(socket.id, isScreenShare);
                if (!transport) {
                    throw new Error('Transport not found');
                }

                const producer = await transport.produce({
                    kind,
                    rtpParameters,
                    appData: { ...appData, isScreenShare }
                });

                const { roomName } = peers[socket.id];

                addProducer(producer, roomName, isScreenShare);

                console.log("screen share in transport produce function - ", isScreenShare);

                producer.on('transportclose', () => {
                    console.log('transport for this producer closed');
                    producer.close();
                    producers = producers.filter(p => p.producer.id !== producer.id);
                });

                if (isScreenShare) {
                    informPeersAboutScreenShare(roomName, socket.id, producer.id);
                } else {
                    informConsumers(roomName, socket.id, producer.id);
                }

                callback({
                    id: producer.id,
                    producersExist: producers.length > 1 ? true : false
                });

            } catch (error) {
                console.error('Error in transport-produce:', error);
                callback({ error: error.message });
            }
        });

        socket.on('transport-recv-connect', async ({ dtlsParameters, serverConsumerTransportId }) => {
            console.log(`DTLS PARAMS: ${dtlsParameters}`)
            console.log('Looking for transport ID:', serverConsumerTransportId) 

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

        socket.on('startScreenShare', async ({ roomName }, callback) => {
            try {
                const router = rooms[roomName].router;

                const transport = await createWebRtcTransport(router, socket.id);

                addTransport(transport, roomName, false, true);  

                socket.to(roomName).emit('new-screen-share-started', {
                    peerId: socket.id
                });

                callback({
                    params: {
                        id: transport.id,
                        iceParameters: transport.iceParameters,
                        iceCandidates: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters,
                        isScreenShare: true  
                    }
                });
            } catch (error) {
                console.error("Error starting screen share:", error);
                callback({ error: error.message });
            }
        });


        socket.on('consume-screen-share', async ({ rtpCapabilities, remoteProducerId }, callback) => {
            try {
                const { roomName } = peers[socket.id];
                const router = rooms[roomName].router;

                const consumerTransport = await createWebRtcTransport(router, socket.id);
                addTransport(consumerTransport, roomName, true, true); 

                if (router.canConsume({ producerId: remoteProducerId, rtpCapabilities })) {
                    const consumer = await consumerTransport.consume({
                        producerId: remoteProducerId,
                        rtpCapabilities,
                        paused: true,
                    });

                    consumer.on('transportclose', () => {
                        console.log('screen share consumer transport closed');
                    });

                    consumer.on('producerclose', () => {
                        console.log('screen share producer closed');
                        socket.emit('screen-share-ended', { remoteProducerId });
                        consumer.close();
                        consumerTransport.close();
                    });

                    console.log("in consumer screen share");

                    addConsumer(consumer, roomName, true);  

                    callback({
                        params: {
                            id: consumer.id,
                            producerId: remoteProducerId,
                            kind: consumer.kind,
                            rtpParameters: consumer.rtpParameters,
                            type: 'screen-share'
                        }
                    });
                }
            } catch (error) {
                console.error('Error in consume-screen-share:', error);
                callback({ error: error.message });
            }
        });

        socket.on('stopScreenShare', async ({ producerId }) => {
            try {
                const producerData = producers.find(p =>
                    p.producer.id === producerId && p.socketId === socket.id
                );

                if (producerData) {
                    const { roomName } = peers[socket.id];

                    // Close the producer
                    producerData.producer.close();

                    // Remove the producer from our list
                    producers = producers.filter(p => p.producer.id !== producerId);

                    // Clean up associated transports
                    const screenShareTransports = transports.filter(t =>
                        t.socketId === socket.id && t.isScreenShare
                    );

                    // Close and clean up each transport
                    for (const transportData of screenShareTransports) {
                        // Close all producers on this transport
                        const transportProducers = producers.filter(p =>
                            p.socketId === socket.id &&
                            p.isScreenShare &&
                            getTransport(socket.id, true)?.id === transportData.transport.id
                        );

                        transportProducers.forEach(({ producer }) => {
                            producer.close();
                        });

                        // Close the transport
                        transportData.transport.close();

                        // Notify peers
                        socket.to(roomName).emit('screen-share-ended', {
                            peerId: socket.id,
                            producerId
                        });
                    }

                    // Clean up transport array
                    transports = transports.filter(t =>
                        !(t.socketId === socket.id && t.isScreenShare)
                    );

                    producers = producers.filter(p =>
                        !(p.socketId === socket.id && p.isScreenShare)
                    );
                    
                }
            } catch (error) {
                console.error('Error stopping screen share:', error);
            }
        });

        const cleanupPeerResources = async (socketId, roomName) => {
            try {
                // Close and remove all producers
                const peerProducers = producers.filter(p => p.socketId === socketId);
                for (const producerData of peerProducers) {
                    producerData.producer.close();
                }
                producers = producers.filter(p => p.socketId !== socketId);

                // Close and remove all consumers
                const peerConsumers = consumers.filter(c => c.socketId === socketId);
                for (const consumerData of peerConsumers) {
                    consumerData.consumer.close();
                }
                consumers = consumers.filter(c => c.socketId !== socketId);

                // Close and remove all transports
                const peerTransports = transports.filter(t => t.socketId === socketId);
                for (const transportData of peerTransports) {
                    transportData.transport.close();
                }
                transports = transports.filter(t => t.socketId !== socketId);

                // Update room peers
                if (rooms[roomName]) {
                    rooms[roomName].peers = rooms[roomName].peers.filter(id => id !== socketId);
                }

                // Clean up peer data
                delete peers[socketId];
            } catch (error) {
                console.error('Error cleaning up peer resources:', error);
            }
        };

        const removeItems = (items, socketId, type) => {
            items.forEach(item => {
                if (item.socketId === socketId) {
                    item[type].close()
                }
            })
            items = items.filter(item => item.socketId !== socketId)

            return items
        }

        socket.on('disconnect', () => {
            console.log('peer disconnected');
            const { roomName } = peers[socket.id] || {};
            if (roomName) {
                cleanupPeerResources(socket.id, roomName);
            }
        });

        socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    });
}

export default mediaSoupSocketConnection
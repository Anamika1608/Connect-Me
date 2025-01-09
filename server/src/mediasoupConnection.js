import mediasoup from "mediasoup";

let worker;
let transports = []

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

        socket.emit('connection-success', {
            socketId: socket.id
        });

        socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    });
}

export default mediaSoupSocketConnection
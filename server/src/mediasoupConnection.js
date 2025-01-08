import mediasoup from "mediasoup";

let worker;

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
const initializeSocket = (io) => {

    io.on('connection', (socket) => {
        console.log('New client connected', socket.id);

        socket.on('disconnect', () => {
            console.log('Client disconnected');
        });

    });
};

export default initializeSocket;

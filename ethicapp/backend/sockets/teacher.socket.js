let teacherSocketInit = (socket) => {
    console.debug('Teacher connected');

    // Join the session
    socket.on('joinSession', (sessionId) => {
        socket.join(`session-${sessionId}`);
        console.debug(`A teacher has joined ${sessionId}`);
    });

    // Notification to the session
    socket.on('broadcastToSession', (sessionId, message) => {
        teacherNamespace.to(`session-${sessionId}`).emit('notification', message);
    });
};

export { teacherSocketInit };
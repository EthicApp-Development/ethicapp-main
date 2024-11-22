// Initialize teacherSocket behavior
let teacherSocketInit = (socket) => {
    console.debug('Teacher connected');

    // Handle a teacher joining a specific session
    socket.on('joinSession', (sessionId) => {
        // Join the socket to a room named `session-{sessionId}`
        socket.join(`session-${sessionId}`);
        console.debug(`A teacher has joined session-${sessionId}`);
    });

    // Handle a teacher leaving a specific session
    socket.on('leaveRoom', (sessionId) => {
        // Leave the socket from the room named `session-{sessionId}`
        socket.leave(`session-${sessionId}`);
        console.debug(`A teacher has left session-${sessionId}`);
    });

    // Broadcast a message to all sockets in a specific session
    socket.on('broadcastToSession', (sessionId, message) => {
        // Emit a notification to all clients in the room `session-{sessionId}`
        teacherNamespace.to(`session-${sessionId}`).emit('notification', message);
        console.debug(`Notification sent to session-${sessionId}:`, message);
    });

    // Handle socket disconnection
    socket.on('disconnect', () => {
        console.debug('Teacher disconnected');
    });
};

// Teacher-Student socket notifications (from backend)
const toTeacherNotifications = (socketNamespace) => {
    return {
        responseSubmitted: (sessionId, phaseId) => {
            socketNamespace.to(`session-${sessionId}`).
                emit("responseSubmitted", { sessionId: sessionId, phaseId: phaseId });
        },

        chatMessage: (sessionId, groupId, messages) => {
            socketNamespace.to(`session-${sessionId}`).emit("onChatMessage", 
                { groupId: groupId, messages: messages });
        }
    };
};


export { teacherSocketInit, toTeacherNotifications };
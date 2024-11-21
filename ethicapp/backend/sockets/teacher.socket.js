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
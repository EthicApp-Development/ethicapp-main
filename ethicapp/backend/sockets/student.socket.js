let studentSocketInit = (socket) => {
    console.debug('Student connected');

    // Join a session, then a group
    socket.on('joinGroup', ({ sessionId, groupId }) => {
        socket.join(`session-${sessionId}`);
        socket.join(`group-${sessionId}-${groupId}`);
        console.debug(`Student joined session ${sessionId}, and group ${groupId}`);
    });

    // Send a message to the group
    socket.on('messageToGroup', ({ sessionId, groupId, message }) => {
        studentNamespace.to(`group-${sessionId}-${groupId}`).emit('groupMessage', message);
    });

    // Broadcast message to everyone in the session
    socket.on('broadcastToSession', (sessionId, message) => {
        studentNamespace.to(`session-${sessionId}`).emit('notification', message);
    });
}

// Teacher-Student socket notifications (from backend)
const toStudentsNotifications = (socketNamespace) => {
    return {
        phaseTransition: (sessionId, phaseId) => {
            socketNamespace.to(`session-${sessionId}`).
                emit("onPhaseTransition", { phaseId });
        },

        chatMessage: (sessionId, groupId, messages) => {
            socketNamespace.to(`group-${sessionId}-${groupId}`).
                emit("onChatMessage", { messages });            
        },

        shareResponse: (sessionId, content) => {
            socketNamespace.to(`session-${sessionId}`).emit("onShareResponse", 
                { content });
        },

        endSession:  (sessionId, content) => {
            socketNamespace.to(`session-${sessionId}`).emit("onEndSession", 
                { content });
        }
    };
};

export { studentSocketInit, toStudentsNotifications };
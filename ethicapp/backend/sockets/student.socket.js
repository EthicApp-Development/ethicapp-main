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

const phaseTransition = (socketNamespace, sessionId) => {
    socketNamespace.to(`session-${sessionId}`).
        emit("phaseTransition", { sessionId: sessionId });
};


export { studentSocketInit };
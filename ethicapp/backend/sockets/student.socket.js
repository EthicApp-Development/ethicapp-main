import * as ChatHelper from "../helpers/chat-helper.js";

let studentSocketInit = (socket, socketNamespace) => {
    console.debug('Student connected');

    // Join a session
    socket.on('joinSession', (sessionId) => {
        socket.join(`session-${sessionId}`);
        console.debug(`A student has joined session-${sessionId}`);
    });

    // Leave a session
    socket.on('leaveSession', (sessionId) => {
        // Leave the socket from the room named `session-{sessionId}`
        socket.leave(`session-${sessionId}`);
        console.debug(`A student has left session-${sessionId}`);
    });

    // Join a group
    socket.on('joinGroup', (groupId) => {
        socket.join(`group-${groupId}`);
        console.debug(`Student joined group ${groupId}`);
    });

    // Leave a group
    socket.on('leaveGroup', (groupId) => {
        // Leave the socket from the room named `group-{groupId}`
        socket.leave(`group-${groupId}`);
        console.debug(`A teacher has left group-${groupId}`);
    });    

    // Send a message to the group
    socket.on('messageToGroup', (data) => {
        // Keep the message
        try {
            ChatHelper.saveChatMessage({ 
                userId: data.content.uid,
                phaseId: data.content.phaseId,
                questionId: data.content.questionId,
                parentId: data.content.parentId,
                content: data.content.text
             });
             socketNamespace.to(`group-${data.groupId}`).emit('onGroupMessage', data.content);    
        } catch (error) {
            console.error(`Failed to process message for group ${groupId}`);
        }
    });

    // Broadcast message to everyone in the session
    socket.on('broadcastToSession', (sessionId, message) => {
        socketNamespace.to(`session-${sessionId}`).emit('notification', message);
    });
}

// Teacher-Student socket notifications (from backend)
const toStudentsNotifications = (socketNamespace) => {
    return {
        phaseTransition: (sessionId, phaseId) => {
            socketNamespace.to(`session-${sessionId}`).
                emit("onPhaseTransition", { phaseId });
        },

        chatMessage: (groupId, messages) => {
            socketNamespace.to(`group-${groupId}`).
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
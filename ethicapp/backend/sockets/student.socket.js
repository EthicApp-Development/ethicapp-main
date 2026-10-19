import { registerGuardedRoom } from "./guarded-rooms.js";
import { roomAccess } from "./socket-room-access.js";

/**
 * Builds the /student connection handler. The namespace middleware
 * (requireSocketRole) has already stored the student's id in socket.data.
 * Rooms are joined only after a server-side participation check; the
 * personal room is always the caller's own.
 */
export function createStudentSocketInit({ access = roomAccess, logger = console } = {}) {
    return (socket) => {
        const { uid } = socket.data;

        registerGuardedRoom(socket, {
            joinEvent:  "joinSession",
            leaveEvent: "leaveSession",
            roomName:   sessionId => `session-${sessionId}`,
            canJoin:    sessionId => access.isSessionParticipant(uid, sessionId),
            logger,
        });

        registerGuardedRoom(socket, {
            joinEvent:  "joinGroup",
            leaveEvent: "leaveGroup",
            roomName:   groupId => `group-${groupId}`,
            canJoin:    groupId => access.isGroupMember(uid, groupId),
            logger,
        });

        // The id sent by legacy clients is ignored: a student can only
        // subscribe to their own external-service results.
        socket.on("joinUser", (_requestedUserId, ack) => {
            socket.join(`user-${uid}`);
            if (typeof ack === "function") {
                ack({ ok: true });
            }
        });

        socket.on("leaveUser", () => {
            socket.leave(`user-${uid}`);
        });
    };
}

const studentSocketInit = createStudentSocketInit();

// Teacher-Student socket notifications (from backend)
const toStudentsNotifications = (socketNamespace) => {
    return {
        phaseTransition: (sessionId) => {
            socketNamespace.to(`session-${sessionId}`).
                emit("onPhaseTransition");
        },
        chatMessage: (groupId) => {
            console.debug(`[student socket] Emitting chat message notification to group ${groupId}`);
            socketNamespace.to(`group-${groupId}`).emit("onChatMessage");
        },

        shareResponse: (sessionId, content) => {
            socketNamespace.to(`session-${sessionId}`).emit("onShareResponse", 
                { content });
        },

        endSession: (sessionId, content) => {
            socketNamespace.to(`session-${sessionId}`).emit("onEndSession", 
                { content });
        },

        externalServiceResult: (userId, payload) => {
            socketNamespace.to(`user-${userId}`).emit("onExternalServiceResult", payload);
        }
    };
};

export { studentSocketInit, toStudentsNotifications };

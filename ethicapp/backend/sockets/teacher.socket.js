import { registerGuardedRoom } from "./guarded-rooms.js";
import { roomAccess } from "./socket-room-access.js";

/**
 * Builds the /teacher connection handler. The namespace middleware
 * (requireSocketRole) has already stored the teacher's id in socket.data.
 * Teachers reach only sessions they created and those sessions' groups.
 */
export function createTeacherSocketInit({ access = roomAccess, logger = console } = {}) {
    return (socket) => {
        const { uid } = socket.data;

        registerGuardedRoom(socket, {
            joinEvent:  "joinSession",
            leaveEvent: "leaveSession",
            roomName:   sessionId => `session-${sessionId}`,
            canJoin:    sessionId => access.ownsSession(uid, sessionId),
            logger,
        });

        registerGuardedRoom(socket, {
            joinEvent:  "joinGroupChat",
            leaveEvent: "leaveGroupChat",
            roomName:   groupId => `teacher-group-${groupId}`,
            canJoin:    groupId => access.ownsGroupSession(uid, groupId),
            logger,
        });
    };
}

const teacherSocketInit = createTeacherSocketInit();

// Teacher-Student socket notifications (from backend)
const toTeacherNotifications = (socketNamespace) => {
    return {
        studentJoined: (sessionId, obj) => {
            socketNamespace.to(`session-${sessionId}`).
                emit("onStudentJoined", obj);
        },

        responseSubmitted: (sessionId, phaseId, responseObj) => {
            socketNamespace.to(`session-${sessionId}`).
                emit("onResponseSubmitted", { 
                    ...responseObj,
                    phaseId
                });
        },

        chatMessage: (sessionId, phaseId, questionId, groupId, message) => {
            socketNamespace.to(`session-${sessionId}`).emit("onChatMessage", { 
                    phaseId,
                    questionId,
                    groupId,
                    message
                });
        },

        groupChatMessage: (groupId, message) => {
            socketNamespace.to(`teacher-group-${groupId}`).
                emit("onGroupChatMessage", message);
        }
    };
};


export { teacherSocketInit, toTeacherNotifications };

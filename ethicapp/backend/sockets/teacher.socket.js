import { CHAT_COMPOSING_NOTICE_EVENT } from "../helpers/composing-signal.js";
import { registerChatComposing } from "./chat-composing.js";
import { registerGuardedRoom } from "./guarded-rooms.js";
import { roomAccess } from "./socket-room-access.js";

// The participants' namespace, where the groups' rooms `group-<groupId>` are.
const STUDENT_NAMESPACE = "/student";

/**
 * The participants' room of a group, reached through the Socket.IO server
 * the teacher's socket belongs to, so this module imports neither the socket
 * configuration nor the student socket.
 *
 * @param {import("socket.io").Socket} socket - A socket of /teacher.
 * @param {number} groupId
 */
function participantsGroupRoom(socket, groupId) {
    return socket.nsp.server.of(STUDENT_NAMESPACE).to(`group-${groupId}`);
}

/**
 * Builds the /teacher connection handler. The namespace middleware
 * (requireSocketRole) has already stored the teacher's id in socket.data.
 * Teachers reach only sessions they created and those sessions' groups.
 *
 * `composing` replaces the dependencies of the `chatComposing` handler
 * (sockets/chat-composing.js) in tests, except its role and its AI services'
 * forwarder: the teacher's signals reach only the group notice (epic #601,
 * #1200).
 */
export function createTeacherSocketInit({
    access = roomAccess,
    logger = console,
    composing = {},
} = {}) {
    return (socket) => {
        const { uid } = socket.data;

        // The teacher's composing signal: the group's participants get the
        // notice, with the teacher's label (`role` "P", `name` null). The
        // access check is the posting rule of the chat for the activity's
        // teacher; nothing goes to AI services.
        registerChatComposing(socket, {
            emitNotice: (groupId, notice) => {
                participantsGroupRoom(socket, groupId).emit(CHAT_COMPOSING_NOTICE_EVENT, notice);
            },
            logger,
            ...composing,
            role:     "P",
            activity: null,
        });

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

/*
 * Teacher-Student socket notifications (from backend), emitted on the
 * /teacher namespace. The teacher's activity dashboard (ethicapp/frontend)
 * consumes them.
 *
 * Room `session-<sessionId>`, joined with `joinSession` by the session's
 * creator (the dashboard joins it in ActivityStateService):
 *
 * - `onStudentJoined`: a participant joined the activity.
 * - `onResponseSubmitted` `{ ...response, phaseId }`.
 * - `onChatMessage` `{ phaseId, questionId, groupId, message }`.
 * - `onExternalServiceInstantiated` `{ serviceId, sessionId, phaseId,
 *   questionId }` (#865).
 * - `onPhaseTransition` `{ sessionId, phaseId, phaseNumber, reason }`: the
 *   activity moved to phase `phaseId` (number `phaseNumber`, from 1). `reason`
 *   is what started it, the phase's `start_trigger`: "teacher" for a teacher's
 *   request (from this dashboard or another one of the same activity),
 *   "deadline" for the deadline runner of a hard-mode activity (#1113). The
 *   same payload as the students' event (#1111).
 * - `onPhaseClock` `{ sessionId, timeMode, finished, phaseId, phaseNumber,
 *   startedAt, endsAt, isLastPhase, serverNow }`: the phase clock after a
 *   change, the answer of GET /activities/:id/clock (helpers/phase-clock.js
 *   documents each field and the edge cases). It follows each
 *   `onPhaseTransition` and each change of the deadline, such as "+1 min"
 *   (#1112). It is read after the change, so it always describes the
 *   activity's current phase. Times are ISO 8601 strings; `serverNow` is the
 *   database's time, for the client's clock offset.
 * - `onPhaseDeadlineReached` `{ sessionId, phaseId, isLastPhase }`: the
 *   deadline of phase `phaseId` passed in a hard-mode activity and the
 *   deadline runner (#1113) started no phase, which happens on the last phase
 *   (`isLastPhase: true`): the activity stays open until the teacher finishes
 *   it (decision of 2026-11-04).
 *
 * Room `teacher-group-<groupId>`, joined with `joinGroupChat`:
 *
 * - `onGroupChatMessage`: a message of the group's chat.
 *
 * Client -> server events, besides joining and leaving rooms:
 *
 * - `chatComposing` `{ phaseId, questionId, groupId, kind }` (epic #601,
 *   #1200; handled by sockets/chat-composing.js): the activity's teacher
 *   started ("composing") or stopped ("stopped") writing in a group's chat.
 *   It is accepted only where the teacher could post a message: the teacher
 *   created the session, the group belongs to the phase, and the chat accepts
 *   messages. The group's participants get `onChatComposing` on /student,
 *   with `role` "P" and `name` null (see sockets/student.socket.js); the
 *   teacher's interface gets nothing, and the signal never reaches AI
 *   services. A payload with any other field is dropped, the writer is
 *   always `socket.data.uid`, and the rate limit is the student socket's.
 *   EXTERNAL.md, "Composing signal", describes the checks.
 */
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
        },

        // An AI service reported an instantiation for the session (#865),
        // for example the mode of a new tutor session: `{ serviceId,
        // sessionId, phaseId, questionId }`.
        serviceInstantiated: (sessionId, payload) => {
            socketNamespace.to(`session-${sessionId}`).
                emit("onExternalServiceInstantiated", payload);
        },

        phaseTransition: (sessionId, transition) => {
            socketNamespace.to(`session-${sessionId}`).emit("onPhaseTransition", transition);
        },

        phaseClock: (sessionId, clock) => {
            socketNamespace.to(`session-${sessionId}`).emit("onPhaseClock", clock);
        },

        phaseDeadlineReached: (sessionId, deadline) => {
            socketNamespace.to(`session-${sessionId}`).emit("onPhaseDeadlineReached", deadline);
        },
    };
};


export { teacherSocketInit, toTeacherNotifications };

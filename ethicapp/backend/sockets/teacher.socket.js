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

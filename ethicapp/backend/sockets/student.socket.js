import { CHAT_COMPOSING_NOTICE_EVENT } from "../helpers/composing-signal.js";
import { createParticipantActivityForwarder } from "../helpers/participant-activity-helper.js";
import { registerChatComposing } from "./chat-composing.js";
import { registerGuardedRoom } from "./guarded-rooms.js";
import { roomAccess } from "./socket-room-access.js";

/**
 * Builds the /student connection handler. The namespace middleware
 * (requireSocketRole) has already stored the student's id in socket.data.
 * Rooms are joined only after a server-side participation check; the
 * personal room is always the caller's own.
 *
 * `composing` replaces the dependencies of the `chatComposing` handler
 * (sockets/chat-composing.js) in tests; `participantActivity` is the AI
 * services' forwarder, whose coalescing state all of the namespace's sockets
 * share.
 */
export function createStudentSocketInit({
    access = roomAccess,
    logger = console,
    participantActivity = createParticipantActivityForwarder({ logger }),
    composing = {},
} = {}) {
    return (socket) => {
        const { uid } = socket.data;

        // A participant's composing signal: the group's other members get the
        // notice, and the phase's AI services the coalesced activity.
        registerChatComposing(socket, {
            role:       "A",
            emitNotice: (groupId, notice) => {
                socket.to(`group-${groupId}`).emit(CHAT_COMPOSING_NOTICE_EVENT, notice);
            },
            activity: participantActivity,
            logger,
            ...composing,
        });

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

/*
 * Teacher-Student socket notifications (from backend), emitted on the
 * /student namespace. The student app (ethicapp-student) consumes them.
 *
 * Room `session-<sessionId>`, joined with `joinSession` by the session's
 * participants:
 *
 * - `onPhaseTransition` `{ sessionId, phaseId, phaseNumber, reason }`: the
 *   activity moved to phase `phaseId` (number `phaseNumber`, from 1). `reason`
 *   is what started it, the phase's `start_trigger`: "teacher" for the
 *   teacher's request, "deadline" for the deadline runner of a hard-mode
 *   activity (#1113). Sent after the commit, once the cached student
 *   descriptor was dropped, so a reload sees the new phase (#906, #1111).
 * - `onPhaseClock` `{ sessionId, timeMode, finished, phaseId, phaseNumber,
 *   startedAt, endsAt, isLastPhase, serverNow }`: the phase clock after a
 *   change, the answer of GET /activities/:id/clock (helpers/phase-clock.js
 *   documents each field and the edge cases). It follows each
 *   `onPhaseTransition` and each change of the deadline, such as "+1 min"
 *   (#1112). It is read after the change, so it always describes the
 *   activity's current phase, which may already be a later one than the
 *   transition it follows. Times are ISO 8601 strings; `serverNow` is the
 *   database's time, for the client's clock offset.
 * - `onShareResponse` `{ content }`.
 * - `onEndSession` `{ content }`: the activity was finished.
 *
 * Room `group-<groupId>`, joined with `joinGroup` by the group's members:
 *
 * - `onChatMessage`, without a payload: the group's chat has a new message.
 * - `onChatComposing` `{ groupId, questionId, userId, role, name, kind }`
 *   (epic #601, #654; sent by sockets/chat-composing.js since #655): a member
 *   (`role` "A") or the activity's teacher (`role` "P") started (`kind`
 *   "composing") or stopped ("stopped") writing in the group's chat. Sent to
 *   every member but the writer's socket, and as "stopped" when the writer's
 *   socket disconnects while composing. `name` comes from
 *   helpers/chat-author-label.js and is never a real name in an anonymous
 *   phase; null means the client shows its translated label. A client drops
 *   "composing" after COMPOSING_NOTICE_TTL_MS without a newer notice.
 *
 * Room `user-<userId>`, the student's own, joined with `joinUser`:
 *
 * - `onExternalServiceResult`: a result an external service published to the
 *   student.
 *
 * Client -> server events, besides joining and leaving rooms:
 *
 * - `chatComposing` `{ phaseId, questionId, groupId, kind }` (epic #601,
 *   #654; handled by sockets/chat-composing.js since #655): the student
 *   started ("composing") or stopped ("stopped") writing in their group's
 *   chat. A payload with any other field
 *   is dropped and the writer is always `socket.data.uid`. Names, fields and
 *   timing are in helpers/composing-signal.js; EXTERNAL.md, "Composing
 *   signal", describes the checks and the rate limit.
 */
const toStudentsNotifications = (socketNamespace) => {
    return {
        phaseTransition: (sessionId, transition) => {
            socketNamespace.to(`session-${sessionId}`).
                emit("onPhaseTransition", transition);
        },

        phaseClock: (sessionId, clock) => {
            socketNamespace.to(`session-${sessionId}`).emit("onPhaseClock", clock);
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

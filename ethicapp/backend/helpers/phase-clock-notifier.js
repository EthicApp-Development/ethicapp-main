/**
 * The phase clock's real-time events (epic #1105, #1111), sent to the
 * students' (/student) and the teacher's (/teacher) Socket.IO namespaces, in
 * the room `session-<sessionId>` of each. sockets/student.socket.js and
 * sockets/teacher.socket.js document every payload.
 *
 * - `phaseStarted`: after a phase start commits (helpers/phase-start-helper.js),
 *   `onPhaseTransition` to both namespaces, then `onPhaseClock` with the clock
 *   read after the commit;
 * - `clockChanged`: after a deadline change, such as "+1 min" (#1112),
 *   `onPhaseClock` to both namespaces;
 * - `deadlineReached`: when the deadline runner (#1113) handles a hard
 *   deadline without starting a phase, `onPhaseDeadlineReached` to the
 *   teacher only.
 *
 * Nothing here throws: an emit or a clock read that fails is logged, since
 * the change it reports is already committed and must stand. Socket.IO has no
 * Redis adapter, so an emit reaches the clients of this process only (epic
 * #1105, "Out of scope").
 */
import { studentNotifications, teacherNotifications } from "../config/socket.config.js";
import { readPhaseClock } from "./phase-clock.js";

/**
 * @param {Object} [dependencies]
 * @param {() => Object|null} [dependencies.students] The /student
 *        notifications (toStudentsNotifications), null before Socket.IO is
 *        initialized.
 * @param {() => Object|null} [dependencies.teachers] The /teacher
 *        notifications (toTeacherNotifications), likewise.
 * @param {(sessionId: number) => Promise<Object|null>} [dependencies.readClock]
 * @param {{ error: Function }} [dependencies.logger]
 */
export function createPhaseClockNotifier({
    students = () => studentNotifications,
    teachers = () => teacherNotifications,
    readClock = readPhaseClock,
    logger = console,
} = {}) {
    const audiences = { students, teachers };

    function emit(audience, method, sessionId, payload) {
        try {
            const notifications = audiences[audience]();
            if (!notifications) {
                throw new Error("Socket.IO is not initialized in this process.");
            }
            notifications[method](sessionId, payload);
        } catch (error) {
            logger.error(`[phase-clock] Could not send ${method} to the ${audience} of `
                + `session ${sessionId}.`, error);
        }
    }

    function emitToBoth(method, sessionId, payload) {
        emit("students", method, sessionId, payload);
        emit("teachers", method, sessionId, payload);
    }

    async function currentClock(sessionId) {
        try {
            return await readClock(sessionId);
        } catch (error) {
            logger.error(`[phase-clock] Could not read the clock of session ${sessionId}.`,
                error);
            return null;
        }
    }

    /**
     * After phase `phaseId` started. The clock is read before either event is
     * sent, so that both reach the clients one right after the other.
     *
     * @param {number} sessionId
     * @param {{ phaseId: number, phaseNumber: number,
     *           reason: "teacher" | "deadline" }} transition
     */
    async function phaseStarted(sessionId, { phaseId, phaseNumber, reason }) {
        const id = Number(sessionId);
        const clock = await currentClock(id);
        emitToBoth("phaseTransition", id, { sessionId: id, phaseId, phaseNumber, reason });
        if (clock) {
            emitToBoth("phaseClock", id, clock);
        }
    }

    /**
     * After the current phase's deadline changed.
     *
     * @param {number} sessionId
     */
    async function clockChanged(sessionId) {
        const id = Number(sessionId);
        const clock = await currentClock(id);
        if (clock) {
            emitToBoth("phaseClock", id, clock);
        }
    }

    /**
     * After the deadline runner handled phase `phaseId`'s hard deadline
     * without starting a phase.
     *
     * @param {number} sessionId
     * @param {{ phaseId: number, isLastPhase: boolean }} deadline
     */
    function deadlineReached(sessionId, { phaseId, isLastPhase }) {
        const id = Number(sessionId);
        emit("teachers", "phaseDeadlineReached", id, { sessionId: id, phaseId, isLastPhase });
    }

    return { phaseStarted, clockChanged, deadlineReached };
}

const defaultPhaseClockNotifier = createPhaseClockNotifier();

export default defaultPhaseClockNotifier;

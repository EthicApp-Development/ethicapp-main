// The phase clock's real-time events (#1111, epic #1105): what each event
// carries, to which namespace and room it goes, and that a failure never
// throws. The notifier runs over the real emit helpers of
// sockets/student.socket.js and sockets/teacher.socket.js, with fake
// Socket.IO namespaces that record each emit, and a fake clock reader.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPhaseClockNotifier } from "../phase-clock-notifier.js";
import { toStudentsNotifications } from "../../sockets/student.socket.js";
import { toTeacherNotifications } from "../../sockets/teacher.socket.js";

const SESSION = 10;

const CLOCK = Object.freeze({
    sessionId:   SESSION,
    timeMode:    "hard",
    finished:    false,
    phaseId:     102,
    phaseNumber: 2,
    startedAt:   "2026-11-11T10:00:00.000Z",
    endsAt:      "2026-11-11T10:05:00.000Z",
    isLastPhase: true,
    serverNow:   "2026-11-11T10:00:00.120Z",
});

// A namespace whose emits land in `log` as [namespace, room, event, payload].
function fakeNamespace(name, log) {
    return {
        to: room => ({
            emit: (event, payload) => {
                log.push([name, room, event, payload]);
            },
        }),
    };
}

function setup({ clock = CLOCK, readClock, students, teachers } = {}) {
    const log = [];
    const errors = [];
    const reads = [];
    const studentNotifications = toStudentsNotifications(fakeNamespace("/student", log));
    const teacherNotifications = toTeacherNotifications(fakeNamespace("/teacher", log));
    const notifier = createPhaseClockNotifier({
        students:  students ?? (() => studentNotifications),
        teachers:  teachers ?? (() => teacherNotifications),
        readClock: readClock ?? (async (sessionId) => {
            reads.push(sessionId);
            return clock;
        }),
        logger: { error: (...args) => errors.push(args) },
    });
    return { notifier, log, errors, reads };
}

const TRANSITION = Object.freeze({ phaseId: 102, phaseNumber: 2, reason: "deadline" });
const TRANSITION_PAYLOAD = Object.freeze({ sessionId: SESSION, ...TRANSITION });

describe("a phase start", () => {
    it("sends the transition, then the clock read after it, to both namespaces", async () => {
        const { notifier, log, reads, errors } = setup();

        await notifier.phaseStarted(SESSION, TRANSITION);

        assert.deepEqual(reads, [SESSION]);
        assert.deepEqual(log, [
            ["/student", "session-10", "onPhaseTransition", TRANSITION_PAYLOAD],
            ["/teacher", "session-10", "onPhaseTransition", TRANSITION_PAYLOAD],
            ["/student", "session-10", "onPhaseClock", CLOCK],
            ["/teacher", "session-10", "onPhaseClock", CLOCK],
        ]);
        assert.deepEqual(errors, []);
    });

    it("carries the teacher's trigger as the reason", async () => {
        const { notifier, log } = setup();

        await notifier.phaseStarted(String(SESSION), { ...TRANSITION, reason: "teacher" });

        assert.deepEqual(log[0][3], { ...TRANSITION_PAYLOAD, reason: "teacher" });
        assert.equal(log[0][1], "session-10");
    });

    it("still sends the transition when the clock cannot be read", async () => {
        const { notifier, log, errors } = setup({
            readClock: async () => {
                throw new Error("database down");
            },
        });

        await notifier.phaseStarted(SESSION, TRANSITION);

        assert.deepEqual(log.map(entry => entry.slice(0, 3)), [
            ["/student", "session-10", "onPhaseTransition"],
            ["/teacher", "session-10", "onPhaseTransition"],
        ]);
        assert.equal(errors.length, 1);
        assert.match(errors[0][0], /Could not read the clock of session 10/u);
    });

    it("sends no clock for a session that is gone", async () => {
        const { notifier, log } = setup({ clock: null });

        await notifier.phaseStarted(SESSION, TRANSITION);

        assert.deepEqual(log.map(entry => entry[2]), ["onPhaseTransition", "onPhaseTransition"]);
    });

    it("reaches the teacher when the students' emit fails, and never throws", async () => {
        const { notifier, log, errors } = setup({
            students: () => ({
                phaseTransition() {
                    throw new Error("socket down");
                },
                phaseClock() {
                    throw new Error("socket down");
                },
            }),
        });

        await notifier.phaseStarted(SESSION, TRANSITION);

        assert.deepEqual(log.map(entry => entry.slice(0, 3)), [
            ["/teacher", "session-10", "onPhaseTransition"],
            ["/teacher", "session-10", "onPhaseClock"],
        ]);
        assert.equal(errors.length, 2);
        assert.match(errors[0][0], /phaseTransition to the students of session 10/u);
    });

    it("logs, without throwing, in a process without Socket.IO", async () => {
        const { notifier, errors } = setup({ students: () => null, teachers: () => null });

        await notifier.phaseStarted(SESSION, TRANSITION);
        await notifier.clockChanged(SESSION);
        notifier.deadlineReached(SESSION, { phaseId: 102, isLastPhase: true });

        // Two events to two audiences, one to two, and one to the teacher.
        assert.equal(errors.length, 7);
        assert.ok(errors.every(([, error]) => /not initialized/u.test(error.message)));
    });
});

describe("a clock change", () => {
    it("sends the clock read after it to both namespaces", async () => {
        const { notifier, log, reads } = setup();

        await notifier.clockChanged(SESSION);

        assert.deepEqual(reads, [SESSION]);
        assert.deepEqual(log, [
            ["/student", "session-10", "onPhaseClock", CLOCK],
            ["/teacher", "session-10", "onPhaseClock", CLOCK],
        ]);
    });
});

describe("a deadline reached without a start", () => {
    it("tells only the teacher", () => {
        const { notifier, log, reads } = setup();

        notifier.deadlineReached(SESSION, { phaseId: 102, isLastPhase: true });

        assert.deepEqual(reads, []);
        assert.deepEqual(log, [[
            "/teacher",
            "session-10",
            "onPhaseDeadlineReached",
            { sessionId: SESSION, phaseId: 102, isLastPhase: true },
        ]]);
    });
});

// The dashboard's state follows the phase events (#1116, epic #1105): phase
// transitions from any source, read once, the latest phase clock with its
// server offset, the last phase's deadline, and a reconnect.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ActivityStateService } from "../activity-state.service.js";

const SESSION_ID = 10;
const LOCAL_NOW = Date.parse("2026-11-11T12:00:00.000Z");

function fakeTeacherSocket() {
    const handlers = {};
    const reconnectListeners = new Set();
    const calls = [];
    return {
        calls,
        fromEvent(name) {
            return {
                subscribe({ next }) {
                    (handlers[name] ||= new Set()).add(next);
                    return { unsubscribe: () => handlers[name].delete(next) };
                },
            };
        },
        joinSession: id => calls.push(["joinSession", id]),
        leaveSession: id => calls.push(["leaveSession", id]),
        onReconnect(listener) {
            reconnectListeners.add(listener);
            return () => reconnectListeners.delete(listener);
        },
        fire(name, payload) {
            (handlers[name] || []).forEach(handler => handler(payload));
        },
        reconnect() {
            reconnectListeners.forEach(listener => listener());
        },
        listenerCount: name => handlers[name]?.size ?? 0,
        reconnectListenerCount: () => reconnectListeners.size,
    };
}

function clockBody(overrides = {}) {
    return {
        sessionId:   SESSION_ID,
        timeMode:    "hard",
        finished:    false,
        phaseId:     41,
        phaseNumber: 2,
        startedAt:   "2026-11-11T11:55:00.000Z",
        endsAt:      "2026-11-11T12:05:00.000Z",
        isLastPhase: false,
        serverNow:   "2026-11-11T12:00:02.000Z",
        ...overrides,
    };
}

// A service whose server is at `server.currentPhase`; the tests move it.
function createService({ clock = clockBody() } = {}) {
    const server = {
        currentPhase: { id: 41, number: 2 },
        clock,
        users:        [{ id: 1, name: "Ana", role: "A" }],
        // Phases the activity moves to, one per read of the phases.
        phaseQueue:   [],
        postHold:     null,
        postError:    null,
    };
    const requests = [];
    const $http = {
        get: async (url) => {
            requests.push(url);
            if (url.endsWith("/descriptor")) {
                return {
                    data: { descriptor: { status: "in_progress", currentPhase: server.currentPhase } },
                };
            }
            if (url.endsWith("/phases")) {
                if (server.phaseQueue.length > 0) {
                    server.currentPhase = server.phaseQueue.shift();
                }
                return { data: { phases: [{ id: 40, number: 1 }, server.currentPhase] } };
            }
            if (url.endsWith("/clock")) {
                return { data: server.clock };
            }
            if (url.endsWith("/users")) {
                return { data: { users: server.users } };
            }
            return { data: { phases: [] } };
        },
        post: async () => {
            await server.postHold;
            if (server.postError) {
                throw server.postError;
            }
            return { data: { status: "ok", phase: server.currentPhase } };
        },
    };
    const socket = fakeTeacherSocket();
    const service = ActivityStateService($http, socket, () => LOCAL_NOW);
    service.activityStates[SESSION_ID] = {
        descriptor: { status: "in_progress", currentPhase: { id: 41, number: 2 } },
    };

    const notified = [];
    ["onPhaseTransition", "onPhaseClock", "onPhaseDeadlineReached", "onActivityResynced"]
        .forEach(name => service.registerListener(name, data => notified.push([name, data])));

    return { service, server, socket, requests, notified };
}

// Subscribes with the state already loaded, as the dashboard leaves it.
function subscribe(context) {
    // No chat watchdog timer, and no log line.
    context.service.startChatRefreshWatchdog = () => {};
    const originalLog = console.log;
    console.log = () => {};
    try {
        return context.service.subscribeToActivityEvents(SESSION_ID);
    } finally {
        console.log = originalLog;
    }
}

// Holds the server's answer to starting the next phase until released.
function holdPost(server) {
    let release;
    server.postHold = new Promise((resolve) => {
        release = resolve;
    });
    return release;
}

// Waits for the phase reads queued so far.
const flush = service => service.handlePhaseTransition(SESSION_ID, { sessionId: 0 });

const PHASE_READS = [
    `/activities/${SESSION_ID}/phases`,
    `/activities/${SESSION_ID}/descriptor`,
    `/activities/${SESSION_ID}/responses`,
];

describe("ActivityStateService phase transitions", () => {
    it("reads the phases once for a phase started by the deadline and tells the dashboard", async () => {
        const context = createService();
        subscribe(context);
        context.server.currentPhase = { id: 42, number: 3 };

        await context.service.handlePhaseTransition(SESSION_ID,
            { sessionId: SESSION_ID, phaseId: 42, phaseNumber: 3, reason: "deadline" });
        await context.service.handlePhaseTransition(SESSION_ID,
            { sessionId: SESSION_ID, phaseId: 42, phaseNumber: 3, reason: "deadline" });

        assert.deepEqual(context.requests, PHASE_READS);
        assert.deepEqual(context.notified, [["onPhaseTransition",
            { sessionId: SESSION_ID, phaseId: 42, phaseNumber: 3, reason: "deadline" }]]);
        assert.deepEqual(context.service.activityStates[SESSION_ID].descriptor.currentPhase,
            { id: 42, number: 3 });
    });

    it("follows the socket event, ignoring another activity's", async () => {
        const context = createService();
        subscribe(context);
        context.server.currentPhase = { id: 42, number: 3 };

        context.socket.fire("onPhaseTransition",
            { sessionId: 11, phaseId: 90, phaseNumber: 3, reason: "deadline" });
        context.socket.fire("onPhaseTransition",
            { sessionId: SESSION_ID, phaseId: 42, phaseNumber: 3, reason: "teacher" });
        await context.service.handlePhaseTransition(SESSION_ID, {});

        assert.deepEqual(context.requests, PHASE_READS);
        assert.deepEqual(context.notified.map(([name, data]) => [name, data.phaseId, data.reason]),
            [["onPhaseTransition", 42, "teacher"]], "a start from another tab");
    });

    it("does not read the dashboard's own start twice, whenever its event arrives", async () => {
        const context = createService();
        subscribe(context);
        const release = holdPost(context.server);
        const event = { sessionId: SESSION_ID, phaseId: 42, phaseNumber: 3, reason: "teacher" };

        // The event arrives while the request runs: it is held.
        const start = context.service.startNextPhase(SESSION_ID, 2);
        context.server.currentPhase = { id: 42, number: 3 };
        await context.service.handlePhaseTransition(SESSION_ID, event);
        release();
        assert.deepEqual(await start, { id: 42, number: 3 });
        await flush(context.service);

        // And once more after the request ended.
        await context.service.handlePhaseTransition(SESSION_ID, event);

        assert.deepEqual(context.requests, PHASE_READS, "one read, by the start itself");
        assert.deepEqual(context.notified, []);
    });

    it("leaves a deadline advance during the teacher's start to the start's 409 path", async () => {
        const context = createService();
        subscribe(context);
        const release = holdPost(context.server);
        context.server.postError = { status: 409, data: { code: "PHASE_CHANGED" } };

        const start = context.service.startNextPhase(SESSION_ID, 2);
        context.server.currentPhase = { id: 42, number: 3 };
        await context.service.handlePhaseTransition(SESSION_ID,
            { sessionId: SESSION_ID, phaseId: 42, phaseNumber: 3, reason: "deadline" });
        release();
        await assert.rejects(start, error => error.status === 409);
        await flush(context.service);

        assert.deepEqual(context.requests, PHASE_READS);
        assert.deepEqual(context.notified, []);
    });

    it("applies a held event for a phase later than the one the start read", async () => {
        const context = createService();
        subscribe(context);
        const release = holdPost(context.server);
        // The start reads phase 3; by the time the held event is checked,
        // the deadline started phase 4.
        context.server.phaseQueue = [{ id: 42, number: 3 }, { id: 43, number: 4 }];

        const start = context.service.startNextPhase(SESSION_ID, 2);
        await context.service.handlePhaseTransition(SESSION_ID,
            { sessionId: SESSION_ID, phaseId: 43, phaseNumber: 4, reason: "deadline" });
        release();
        await start;
        await flush(context.service);

        assert.deepEqual(context.requests, [...PHASE_READS, ...PHASE_READS]);
        assert.deepEqual(context.notified, [["onPhaseTransition",
            { sessionId: SESSION_ID, phaseId: 43, phaseNumber: 4, reason: "deadline" }]]);
    });
});

describe("ActivityStateService phase clock", () => {
    it("keeps the clock it reads with the server offset, and tells the dashboard", async () => {
        const context = createService();

        const kept = await context.service.refreshPhaseClock(SESSION_ID);

        assert.deepEqual(context.requests, [`/activities/${SESSION_ID}/clock`]);
        assert.deepEqual(kept, { ...clockBody(), offsetMs: 2000, receivedAt: LOCAL_NOW });
        assert.equal(context.service.getPhaseClock(SESSION_ID), kept);
        assert.equal(context.service.getPhaseClock(String(SESSION_ID)), kept);
        assert.deepEqual(context.notified, [["onPhaseClock", kept]]);
    });

    it("keeps the socket's clocks of this activity and ignores stale ones", async () => {
        const context = createService();
        subscribe(context);

        context.socket.fire("onPhaseClock", clockBody());
        context.socket.fire("onPhaseClock", clockBody({ sessionId: 11, phaseId: 90 }));
        context.socket.fire("onPhaseClock", clockBody({
            phaseId: 40, phaseNumber: 1, serverNow: "2026-11-11T12:00:09.000Z",
        }));
        context.socket.fire("onPhaseClock", clockBody({
            endsAt: "2026-11-11T12:06:00.000Z", serverNow: "2026-11-11T12:00:04.000Z",
        }));
        context.socket.fire("onPhaseClock", clockBody({ serverNow: "2026-11-11T12:00:03.000Z" }));

        assert.equal(context.service.getPhaseClock(SESSION_ID).endsAt, "2026-11-11T12:06:00.000Z");
        assert.equal(context.service.getPhaseClock(SESSION_ID).offsetMs, 4000);
        assert.equal(context.notified.length, 2);
    });

    it("keeps the clock it had when the read fails", async () => {
        const context = createService();
        context.service.acceptPhaseClock(SESSION_ID, clockBody());
        const kept = context.service.getPhaseClock(SESSION_ID);
        const originalError = console.error;
        console.error = () => {};
        context.server.clock = undefined;

        try {
            assert.equal(await context.service.refreshPhaseClock(SESSION_ID), kept);
        } finally {
            console.error = originalError;
        }
    });

    it("is null before it is read, and forgotten when the dashboard unsubscribes", () => {
        const context = createService();
        assert.equal(context.service.getPhaseClock(SESSION_ID), null);
        const unsubscribe = subscribe(context);
        context.socket.fire("onPhaseClock", clockBody());
        assert.notEqual(context.service.getPhaseClock(SESSION_ID), null);

        unsubscribe();
        assert.equal(context.service.getPhaseClock(SESSION_ID), null);
        assert.equal(context.socket.listenerCount("onPhaseClock"), 0);
        assert.equal(context.socket.listenerCount("onPhaseTransition"), 0);
        assert.equal(context.socket.listenerCount("onPhaseDeadlineReached"), 0);
        assert.equal(context.socket.reconnectListenerCount(), 0);
        assert.deepEqual(context.socket.calls,
            [["joinSession", SESSION_ID], ["leaveSession", SESSION_ID]]);
    });
});

describe("ActivityStateService last phase deadline", () => {
    it("passes this activity's deadline to the dashboard", () => {
        const context = createService();
        subscribe(context);
        const event = { sessionId: SESSION_ID, phaseId: 43, isLastPhase: true };

        context.socket.fire("onPhaseDeadlineReached", { ...event, sessionId: 11 });
        context.socket.fire("onPhaseDeadlineReached", event);

        assert.deepEqual(context.notified, [["onPhaseDeadlineReached", event]]);
    });
});

describe("ActivityStateService after a reconnect", () => {
    it("reads the participants, the phases and the clock again, then tells the dashboard", async () => {
        const context = createService();
        subscribe(context);
        context.server.users = [{ id: 1 }, { id: 2 }];

        context.socket.reconnect();
        await context.service.resyncAfterReconnect(SESSION_ID);

        assert.deepEqual(context.requests.slice(0, 5), [
            `/sessions/${SESSION_ID}/users`,
            ...PHASE_READS,
            `/activities/${SESSION_ID}/clock`,
        ]);
        assert.deepEqual(context.service.activityStates[SESSION_ID].users, [{ id: 1 }, { id: 2 }]);
        assert.equal(context.service.getPhaseClock(SESSION_ID).phaseId, 41);
        assert.deepEqual(context.notified.filter(([name]) => name !== "onPhaseClock"), [
            ["onActivityResynced", { sessionId: SESSION_ID }],
            ["onActivityResynced", { sessionId: SESSION_ID }],
        ]);
    });

    it("tells the dashboard of a phase that started while it was disconnected", async () => {
        const context = createService();
        subscribe(context);
        context.server.currentPhase = { id: 42, number: 3 };
        context.server.clock = clockBody({ phaseId: 42, phaseNumber: 3 });

        await context.service.resyncAfterReconnect(SESSION_ID);

        assert.deepEqual(context.notified.map(([name, data]) => [name, data.phaseId ?? null]), [
            ["onPhaseClock", 42],
            ["onPhaseTransition", 42],
            ["onActivityResynced", null],
        ]);
        assert.equal(context.notified[1][1].reason, null, "no toast: the reason is unknown");
    });
});

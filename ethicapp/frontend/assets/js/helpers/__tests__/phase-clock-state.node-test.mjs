// The phase clock the dashboard keeps (#1116): its server offset, and the
// late clocks it ignores.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    clockOffsetMs,
    deadlinePassed,
    isSessionEvent,
    nextPhaseClock,
    serverTimeMs,
} from "../phase-clock-state.js";

const SESSION_ID = 10;
const LOCAL_NOW = Date.parse("2026-11-11T12:00:00.000Z");

function clock(overrides = {}) {
    return {
        sessionId:   SESSION_ID,
        timeMode:    "hard",
        finished:    false,
        phaseId:     41,
        phaseNumber: 2,
        startedAt:   "2026-11-11T11:55:00.000Z",
        endsAt:      "2026-11-11T12:05:00.000Z",
        isLastPhase: false,
        serverNow:   "2026-11-11T12:00:03.000Z",
        ...overrides,
    };
}

describe("clockOffsetMs and serverTimeMs", () => {
    it("is the server's time minus the local time", () => {
        assert.equal(clockOffsetMs("2026-11-11T12:00:03.000Z", LOCAL_NOW), 3000);
        assert.equal(clockOffsetMs("2026-11-11T11:59:58.500Z", LOCAL_NOW), -1500);
    });

    it("is 0 for a missing or invalid server time", () => {
        assert.equal(clockOffsetMs(null, LOCAL_NOW), 0);
        assert.equal(clockOffsetMs("not a date", LOCAL_NOW), 0);
    });

    it("estimates the server's time from the kept offset", () => {
        assert.equal(serverTimeMs({ offsetMs: 3000 }, LOCAL_NOW), LOCAL_NOW + 3000);
        assert.equal(serverTimeMs(null, LOCAL_NOW), LOCAL_NOW);
    });
});

describe("isSessionEvent", () => {
    it("matches the activity by number", () => {
        assert.equal(isSessionEvent({ sessionId: 10 }, "10"), true);
        assert.equal(isSessionEvent({ sessionId: "10" }, 10), true);
        assert.equal(isSessionEvent({ sessionId: 11 }, 10), false);
        assert.equal(isSessionEvent({}, 10), false);
        assert.equal(isSessionEvent(null, 10), false);
    });
});

describe("nextPhaseClock", () => {
    const options = { sessionId: SESSION_ID, localNowMs: LOCAL_NOW };

    it("keeps the first clock with its offset and arrival time", () => {
        const { accepted, clock: kept } = nextPhaseClock(null, clock(), options);
        assert.equal(accepted, true);
        assert.deepEqual(kept, { ...clock(), offsetMs: 3000, receivedAt: LOCAL_NOW });
    });

    it("ignores another activity's clock and a payload that is not a clock", () => {
        const current = nextPhaseClock(null, clock(), options).clock;
        assert.deepEqual(nextPhaseClock(current, clock({ sessionId: 11 }), options),
            { accepted: false, clock: current });
        assert.equal(nextPhaseClock(null, undefined, options).accepted, false);
        assert.equal(nextPhaseClock(null, "clock", options).accepted, false);
    });

    it("ignores a clock of an earlier phase", () => {
        const current = nextPhaseClock(null, clock(), options).clock;
        const stale = clock({ phaseId: 40, phaseNumber: 1, serverNow: "2026-11-11T12:00:09.000Z" });
        assert.equal(nextPhaseClock(current, stale, options).accepted, false);
        const beforeFirst = clock({ phaseId: null, phaseNumber: null, endsAt: null });
        assert.equal(nextPhaseClock(current, beforeFirst, options).accepted, false);
    });

    it("ignores a clock of the same phase read before the kept one", () => {
        const extended = clock({ endsAt: "2026-11-11T12:06:00.000Z", serverNow: "2026-11-11T12:00:05.000Z" });
        const current = nextPhaseClock(null, extended, options).clock;
        const lateRead = clock({ serverNow: "2026-11-11T12:00:04.000Z" });
        assert.equal(nextPhaseClock(current, lateRead, options).accepted, false);
    });

    it("keeps a later clock of the same phase, such as after \"+1 min\"", () => {
        const current = nextPhaseClock(null, clock(), options).clock;
        const extended = clock({ endsAt: "2026-11-11T12:06:00.000Z", serverNow: "2026-11-11T12:00:30.000Z" });
        const next = nextPhaseClock(current, extended, { ...options, localNowMs: LOCAL_NOW + 27000 });
        assert.equal(next.accepted, true);
        assert.equal(next.clock.endsAt, "2026-11-11T12:06:00.000Z");
        assert.equal(next.clock.offsetMs, 3000);
    });

    it("keeps a clock of a later phase and the finished clock, then nothing before it", () => {
        let current = nextPhaseClock(null, clock(), options).clock;
        current = nextPhaseClock(current, clock({ phaseId: 42, phaseNumber: 3 }), options).clock;
        assert.equal(current.phaseId, 42);

        const finished = clock({
            finished:    true, phaseId:     null, phaseNumber: null, startedAt:   null, endsAt:      null,
            isLastPhase: null, serverNow:   "2026-11-11T12:10:00.000Z",
        });
        current = nextPhaseClock(current, finished, options).clock;
        assert.equal(current.finished, true);
        assert.equal(nextPhaseClock(current, clock({ phaseId: 42, phaseNumber: 3 }), options).accepted,
            false);
    });
});

describe("deadlinePassed", () => {
    it("compares the deadline with the server's estimated time", () => {
        const kept = { endsAt: "2026-11-11T12:00:02.000Z", offsetMs: 3000 };
        assert.equal(deadlinePassed(kept, LOCAL_NOW), true, "the server is 3 s ahead");
        assert.equal(deadlinePassed({ ...kept, offsetMs: 0 }, LOCAL_NOW), false);
        assert.equal(deadlinePassed({ endsAt: "2026-11-11T12:00:00.000Z", offsetMs: 0 }, LOCAL_NOW),
            true, "at 00:00");
    });

    it("is false without a deadline", () => {
        assert.equal(deadlinePassed({ endsAt: null, offsetMs: 0 }, LOCAL_NOW), false);
        assert.equal(deadlinePassed(null, LOCAL_NOW), false);
    });
});

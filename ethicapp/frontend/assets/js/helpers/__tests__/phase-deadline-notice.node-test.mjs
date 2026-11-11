// The notice for the last phase's deadline in a hard-mode activity (#1116).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lastPhaseDeadlineNotice, reachedDeadline } from "../phase-deadline-notice.js";

const SESSION_ID = 10;
const LOCAL_NOW = Date.parse("2026-11-11T12:00:00.000Z");
const ENDS_AT = "2026-11-11T12:00:00.000Z";

function lastPhaseClock(overrides = {}) {
    return {
        sessionId:   SESSION_ID,
        timeMode:    "hard",
        finished:    false,
        phaseId:     43,
        phaseNumber: 3,
        endsAt:      ENDS_AT,
        isLastPhase: true,
        serverNow:   "2026-11-11T11:59:59.000Z",
        offsetMs:    0,
        ...overrides,
    };
}

const deadlineEvent = (overrides = {}) =>
    ({ sessionId: SESSION_ID, phaseId: 43, isLastPhase: true, ...overrides });

describe("reachedDeadline", () => {
    it("records the last phase's deadline the server reported", () => {
        assert.deepEqual(reachedDeadline(deadlineEvent(), lastPhaseClock(), SESSION_ID),
            { phaseId: 43, endsAt: ENDS_AT });
        assert.deepEqual(reachedDeadline(deadlineEvent(), null, SESSION_ID),
            { phaseId: 43, endsAt: null }, "before the clock is read");
    });

    it("ignores another activity, a phase that is not the last and another phase", () => {
        assert.equal(reachedDeadline(deadlineEvent({ sessionId: 11 }), lastPhaseClock(), SESSION_ID),
            null);
        assert.equal(reachedDeadline(deadlineEvent({ isLastPhase: false }), lastPhaseClock(),
            SESSION_ID), null);
        assert.equal(reachedDeadline(deadlineEvent({ phaseId: 42 }), lastPhaseClock(), SESSION_ID),
            null);
    });
});

describe("lastPhaseDeadlineNotice", () => {
    const expected = { key: `43|${ENDS_AT}`, phaseId: 43, endsAt: ENDS_AT };

    it("shows at 00:00 by the server's time, without the event", () => {
        assert.deepEqual(lastPhaseDeadlineNotice(lastPhaseClock(), { localNowMs: LOCAL_NOW }),
            expected);
        assert.equal(lastPhaseDeadlineNotice(lastPhaseClock(), { localNowMs: LOCAL_NOW - 1000 }),
            null, "a second before");
        assert.deepEqual(lastPhaseDeadlineNotice(lastPhaseClock({ offsetMs: 1000 }),
            { localNowMs: LOCAL_NOW - 1000 }), expected, "the server is a second ahead");
    });

    it("shows when the server reports the deadline, even if the local clock is behind", () => {
        assert.deepEqual(lastPhaseDeadlineNotice(lastPhaseClock(), {
            localNowMs: LOCAL_NOW - 5000,
            reached:    { phaseId: 43, endsAt: ENDS_AT },
        }), expected);
    });

    it("goes away when \"+1 min\" moves the deadline", () => {
        const extended = lastPhaseClock({ endsAt: "2026-11-11T12:01:00.000Z" });
        assert.equal(lastPhaseDeadlineNotice(extended, {
            localNowMs: LOCAL_NOW,
            reached:    { phaseId: 43, endsAt: ENDS_AT },
        }), null);
    });

    it("stays closed for the deadline the teacher dismissed, not for a later one", () => {
        assert.equal(lastPhaseDeadlineNotice(lastPhaseClock(),
            { localNowMs: LOCAL_NOW, dismissedKey: expected.key }), null);
        const later = lastPhaseClock({ endsAt: "2026-11-11T12:01:00.000Z" });
        assert.equal(lastPhaseDeadlineNotice(later, {
            localNowMs:   LOCAL_NOW + 60000,
            dismissedKey: expected.key,
        }).phaseId, 43);
    });

    it("never shows in soft mode, without a clock, on another phase or once finished", () => {
        const options = { localNowMs: LOCAL_NOW + 60000 };
        assert.equal(lastPhaseDeadlineNotice(lastPhaseClock({ timeMode: "soft" }), options), null);
        assert.equal(lastPhaseDeadlineNotice(lastPhaseClock({ timeMode: "none", endsAt: null }),
            options), null);
        assert.equal(lastPhaseDeadlineNotice(lastPhaseClock({ isLastPhase: false }), options), null);
        assert.equal(lastPhaseDeadlineNotice(lastPhaseClock({ endsAt: null }), options), null);
        assert.equal(lastPhaseDeadlineNotice(lastPhaseClock({ finished: true, phaseId: null }),
            options), null);
        assert.equal(lastPhaseDeadlineNotice(null, options), null);
    });
});

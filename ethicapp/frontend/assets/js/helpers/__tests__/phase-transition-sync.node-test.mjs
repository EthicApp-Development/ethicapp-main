// What the dashboard does with an `onPhaseTransition` (#1116): it reads
// the phases once per phase it does not know yet.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    TRANSITION_ACTIONS,
    isDeadlineAdvance,
    phaseTransitionAction,
    phaseTransitionNotice,
} from "../phase-transition-sync.js";

const SESSION_ID = 10;
const event = (overrides = {}) => ({
    sessionId: SESSION_ID, phaseId: 42, phaseNumber: 3, reason: "deadline", ...overrides,
});
const descriptor = (currentPhase = { id: 41, number: 2 }, status = "in_progress") =>
    ({ status, currentPhase });
const context = (overrides = {}) => ({
    sessionId: SESSION_ID, descriptor: descriptor(), ownStartPending: false, ...overrides,
});

describe("phaseTransitionAction", () => {
    it("applies a phase the dashboard does not know yet", () => {
        assert.equal(phaseTransitionAction(event(), context()), TRANSITION_ACTIONS.APPLY);
        assert.equal(phaseTransitionAction(event({ phaseId: 40, phaseNumber: 1 }),
            context({ descriptor: descriptor(null) })), TRANSITION_ACTIONS.APPLY,
        "the first phase");
    });

    it("ignores another activity's event and one without a phase", () => {
        assert.equal(phaseTransitionAction(event({ sessionId: 11 }), context()),
            TRANSITION_ACTIONS.IGNORE);
        assert.equal(phaseTransitionAction(event({ phaseId: null }), context()),
            TRANSITION_ACTIONS.IGNORE);
    });

    it("ignores an event while the activity is not loaded, or once it is finished", () => {
        assert.equal(phaseTransitionAction(event(), context({ descriptor: undefined })),
            TRANSITION_ACTIONS.IGNORE);
        assert.equal(phaseTransitionAction(event(),
            context({ descriptor: descriptor(null, "finished") })), TRANSITION_ACTIONS.IGNORE);
    });

    it("ignores the phase the dashboard already shows, and an earlier one", () => {
        assert.equal(phaseTransitionAction(event({ phaseId: 41, phaseNumber: 2 }), context()),
            TRANSITION_ACTIONS.IGNORE);
        assert.equal(phaseTransitionAction(event({ phaseId: 39, phaseNumber: 2 }), context()),
            TRANSITION_ACTIONS.IGNORE);
        assert.equal(phaseTransitionAction(event({ phaseId: 40, phaseNumber: 1 }), context()),
            TRANSITION_ACTIONS.IGNORE);
    });

    it("defers while this dashboard's own start is running", () => {
        assert.equal(phaseTransitionAction(event({ reason: "teacher" }),
            context({ ownStartPending: true })), TRANSITION_ACTIONS.DEFER);
    });
});

describe("phaseTransitionNotice", () => {
    it("tells the phase the activity is at, with the event's reason", () => {
        assert.deepEqual(phaseTransitionNotice("10", descriptor({ id: 43, number: 4 }), "deadline"),
            { sessionId: 10, phaseId: 43, phaseNumber: 4, reason: "deadline" });
        assert.deepEqual(phaseTransitionNotice(10, descriptor({ id: 43, number: 4 }), undefined),
            { sessionId: 10, phaseId: 43, phaseNumber: 4, reason: null });
    });

    it("is null without a current phase", () => {
        assert.equal(phaseTransitionNotice(10, descriptor(null), "teacher"), null);
        assert.equal(phaseTransitionNotice(10, undefined, "teacher"), null);
    });
});

describe("isDeadlineAdvance", () => {
    it("is true only for an advance by the deadline", () => {
        assert.equal(isDeadlineAdvance({ reason: "deadline" }), true);
        assert.equal(isDeadlineAdvance({ reason: "teacher" }), false);
        assert.equal(isDeadlineAdvance({ reason: null }), false);
        assert.equal(isDeadlineAdvance(null), false);
    });
});

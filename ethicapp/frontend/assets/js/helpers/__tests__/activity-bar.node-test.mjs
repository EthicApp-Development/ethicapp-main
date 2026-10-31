import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ACTIVITY_STATUSES,
    activityStatus,
    connectedStudentCount,
    currentPhaseSummary,
} from "../activity-bar.js";

describe("activityStatus", () => {
    it("takes the status by name", () => {
        for (const status of ACTIVITY_STATUSES) {
            assert.equal(activityStatus(status), status);
        }
    });

    it("takes the status by code, as a number or a string", () => {
        assert.equal(activityStatus(1), "initiated");
        assert.equal(activityStatus(2), "in_progress");
        assert.equal(activityStatus("3"), "finished");
    });

    it("says finished once the teacher ends the activity, before the descriptor is read again", () => {
        assert.equal(activityStatus("in_progress", true), "finished");
        assert.equal(activityStatus(undefined, true), "finished");
    });

    it("is null for a missing or unknown status", () => {
        assert.equal(activityStatus(undefined), null);
        assert.equal(activityStatus(null), null);
        assert.equal(activityStatus(""), null);
        assert.equal(activityStatus("archived"), null);
        assert.equal(activityStatus(9), null);
    });
});

describe("currentPhaseSummary", () => {
    const descriptor = {
        phases: [
            { id: 40, number: 1, mode: "individual" },
            { id: 41, number: 2, mode: "team" },
        ],
        currentPhase: { id: 41, number: 2, mode: "team" },
    };

    it("gives the number, the total and the mode of the current phase", () => {
        assert.deepEqual(currentPhaseSummary(descriptor, 3), {
            number:  2,
            total:   3,
            modeKey: "activity_bar_phase_mode_team",
        });
    });

    it("reads the mode from the phase list when the current phase lacks it", () => {
        const summary = currentPhaseSummary({
            phases:       [{ id: "7", number: 1, mode: "team" }],
            currentPhase: { id: 7, number: 1 },
        }, 2);
        assert.equal(summary.modeKey, "activity_bar_phase_mode_team");
    });

    it("treats any mode other than team as individual", () => {
        const summary = currentPhaseSummary({
            phases:       [],
            currentPhase: { id: 1, number: 1, mode: "individual" },
        }, 1);
        assert.equal(summary.modeKey, "activity_bar_phase_mode_individual");
        assert.equal(currentPhaseSummary({ currentPhase: { id: 1, number: 1 } }, 1).modeKey,
            "activity_bar_phase_mode_individual");
    });

    it("never gives a total below the current number", () => {
        assert.equal(currentPhaseSummary(descriptor, 1).total, 2);
    });

    it("is null before the first phase or while the design is loading", () => {
        assert.equal(currentPhaseSummary({ phases: [], currentPhase: null }, 3), null);
        assert.equal(currentPhaseSummary(undefined, 3), null);
        assert.equal(currentPhaseSummary(descriptor, undefined), null);
        assert.equal(currentPhaseSummary(descriptor, 0), null);
    });
});

describe("connectedStudentCount", () => {
    it("counts the students who joined, not the teachers", () => {
        assert.equal(connectedStudentCount([
            { id: 1, role: "A" },
            { id: 2, role: "P" },
            { id: 3, role: "A" },
        ]), 2);
    });

    it("counts users without a role, as announced by a join event", () => {
        assert.equal(connectedStudentCount([{ id: 1 }, { id: 2, role: "A" }]), 2);
    });

    it("is zero without a list", () => {
        assert.equal(connectedStudentCount(undefined), 0);
        assert.equal(connectedStudentCount(null), 0);
        assert.equal(connectedStudentCount([]), 0);
    });
});

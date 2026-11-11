import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PHASE_DURATION_DEFAULT_MINUTES,
    hasInvalidPhaseDuration,
    isPhaseDurationEnabled,
    isValidPhaseDuration,
    phaseDurationErrors,
    phaseDurationSwitch,
    plannedDesignDuration,
    plannedDesignDurationText,
    setPhaseDurationEnabled,
} from "../phase-duration.js";

describe("isValidPhaseDuration (#1107)", () => {
    it("accepts whole minutes from 1 to 180 only", () => {
        for (const minutes of [1, 10, 180]) {
            assert.equal(isValidPhaseDuration(minutes), true, String(minutes));
        }
        for (const minutes of [0, -5, 181, 2.5, "10", null, undefined, NaN]) {
            assert.equal(isValidPhaseDuration(minutes), false, JSON.stringify(minutes));
        }
    });
});

describe("setPhaseDurationEnabled and phaseDurationSwitch (#1107)", () => {
    it("turning the duration on sets 10 minutes", () => {
        const phase = { mode: "individual" };

        setPhaseDurationEnabled(phase, true);

        assert.equal(PHASE_DURATION_DEFAULT_MINUTES, 10);
        assert.equal(phase.durationMinutes, 10);
        assert.equal(isPhaseDurationEnabled(phase), true);
    });

    it("turning it on again keeps a valid value", () => {
        const phase = { durationMinutes: 25 };

        setPhaseDurationEnabled(phase, true);

        assert.equal(phase.durationMinutes, 25);
    });

    it("turning the duration off deletes the key, never stores null or 0", () => {
        const phase = { mode: "individual", durationMinutes: 25 };

        setPhaseDurationEnabled(phase, false);

        assert.equal(Object.hasOwn(phase, "durationMinutes"), false);
        assert.equal(JSON.stringify(phase), JSON.stringify({ mode: "individual" }));
    });

    it("the switch reads and writes the phase as a getter-setter", () => {
        const phase = {};
        const durationSwitch = phaseDurationSwitch(phase);

        assert.equal(durationSwitch(), false);
        assert.equal(durationSwitch(true), true);
        assert.equal(phase.durationMinutes, 10);
        assert.equal(durationSwitch(), true);
        assert.equal(durationSwitch(false), false);
        assert.equal(Object.hasOwn(phase, "durationMinutes"), false);
    });

    it("the switch stays on while the field is empty or invalid", () => {
        for (const minutes of [null, undefined, 0]) {
            assert.equal(phaseDurationSwitch({ durationMinutes: minutes })(), true,
                JSON.stringify(minutes));
        }
    });

    it("ignores values that are not phases", () => {
        assert.doesNotThrow(() => setPhaseDurationEnabled(null, true));
        assert.equal(isPhaseDurationEnabled(undefined), false);
    });
});

describe("phaseDurationErrors and hasInvalidPhaseDuration (#1107)", () => {
    it("has no errors without a duration or with a valid one", () => {
        assert.deepEqual(phaseDurationErrors({}), []);
        assert.deepEqual(phaseDurationErrors({ durationMinutes: 45 }), []);
        assert.equal(hasInvalidPhaseDuration([{}, { durationMinutes: 45 }]), false);
        assert.equal(hasInvalidPhaseDuration(undefined), false);
    });

    it("reports a present duration that is not valid", () => {
        for (const minutes of [0, 181, 2.5, "10", null, undefined]) {
            assert.deepEqual(phaseDurationErrors({ durationMinutes: minutes }),
                ["error_phase_duration_invalid"], JSON.stringify(minutes));
        }
        assert.equal(hasInvalidPhaseDuration([{}, { durationMinutes: 0 }]), true);
    });
});

describe("plannedDesignDuration and plannedDesignDurationText (#1107)", () => {
    const phases = [
        { durationMinutes: 10 },
        { durationMinutes: 20 },
        {},
        { durationMinutes: 15 },
    ];

    it("adds the valid durations and counts the timed phases", () => {
        assert.deepEqual(plannedDesignDuration(phases),
            { totalMinutes: 45, timedPhaseCount: 3, phaseCount: 4 });
        assert.deepEqual(plannedDesignDuration([{ durationMinutes: null }, {}]),
            { totalMinutes: 0, timedPhaseCount: 0, phaseCount: 2 });
        assert.deepEqual(plannedDesignDuration(undefined),
            { totalMinutes: 0, timedPhaseCount: 0, phaseCount: 0 });
    });

    it("gives the summary of a design with durations, and nothing otherwise", () => {
        assert.deepEqual(plannedDesignDurationText(phases), {
            key:    "design_planned_duration_summary",
            values: { minutes: 45, timed: 3, total: 4 },
        });
        assert.deepEqual(plannedDesignDurationText([{ durationMinutes: 30 }]), {
            key:    "design_planned_duration_single_phase",
            values: { minutes: 30, timed: 1, total: 1 },
        });
        assert.equal(plannedDesignDurationText([{}, {}]), null);
        assert.equal(plannedDesignDurationText([]), null);
    });
});

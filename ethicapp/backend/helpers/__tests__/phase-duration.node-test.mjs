import assert from "node:assert/strict";
import test from "node:test";
import {
    INVALID_PHASE_DURATION_CODE,
    invalidPhaseDurations,
    isValidPhaseDuration,
    phaseDurationRefusal,
} from "../phase-duration.js";

function designWithDurations(...durations) {
    return {
        type:   "semantic_differential",
        phases: durations.map(minutes => (minutes === undefined
            ? { mode: "individual" }
            : { mode: "individual", durationMinutes: minutes })),
    };
}

test("isValidPhaseDuration: whole minutes from 1 to 180", () => {
    for (const minutes of [1, 10, 45, 180]) {
        assert.equal(isValidPhaseDuration(minutes), true, String(minutes));
    }
    for (const minutes of [0, -5, 181, 2.5, "10", null, undefined, NaN, Infinity, true, [10]]) {
        assert.equal(isValidPhaseDuration(minutes), false, JSON.stringify(minutes));
    }
});

test("invalidPhaseDurations: phases without the key have no duration to check", () => {
    assert.deepEqual(invalidPhaseDurations(designWithDurations(undefined, undefined)), []);
    assert.deepEqual(invalidPhaseDurations(designWithDurations(10, undefined, 180)), []);
});

test("invalidPhaseDurations: lists the 0-based index of every invalid duration", () => {
    const design = designWithDurations(10, 0, undefined, null, "10", 2.5, 181, -5);

    assert.deepEqual(invalidPhaseDurations(design), [
        { phaseIndex: 1 },
        { phaseIndex: 3 },
        { phaseIndex: 4 },
        { phaseIndex: 5 },
        { phaseIndex: 6 },
        { phaseIndex: 7 },
    ]);
});

test("invalidPhaseDurations: tolerates designs without phases and malformed phases", () => {
    for (const design of [undefined, null, {}, { phases: null }, { phases: "x" }]) {
        assert.deepEqual(invalidPhaseDurations(design), [], JSON.stringify(design));
    }
    assert.deepEqual(invalidPhaseDurations({ phases: [null, 3, "phase"] }), []);
});

test("phaseDurationRefusal: null when every duration is valid or absent", () => {
    assert.equal(phaseDurationRefusal(designWithDurations(undefined, 30)), null);
});

test("phaseDurationRefusal: 400 INVALID_PHASE_DURATION with the invalid phases", () => {
    const refusal = phaseDurationRefusal(designWithDurations(30, 0));

    assert.equal(refusal.status, 400);
    assert.equal(refusal.body.status, "err");
    assert.equal(refusal.body.code, INVALID_PHASE_DURATION_CODE);
    assert.equal(INVALID_PHASE_DURATION_CODE, "INVALID_PHASE_DURATION");
    assert.deepEqual(refusal.body.errors, [{ phaseIndex: 1 }]);
    assert.match(refusal.body.message, /1 to 180/u);
});

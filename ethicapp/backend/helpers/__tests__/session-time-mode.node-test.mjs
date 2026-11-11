// An activity's time mode (#1109, epic #1105): what a launch request may ask
// for, what a launch stores for a design with or without durations, and how
// a stored row reads.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    INVALID_TIME_MODE_CODE,
    TIME_MODES,
    designHasTimedPhase,
    invalidTimeModeRefusal,
    launchTimeMode,
    requestedTimeMode,
    sessionTimeMode,
} from "../session-time-mode.js";

const TIMED = { phases: [{}, { durationMinutes: 15 }] };
const UNTIMED = { phases: [{}, {}] };

describe("requestedTimeMode", () => {
    it("accepts the three modes", () => {
        assert.equal(requestedTimeMode("soft"), "soft");
        assert.equal(requestedTimeMode("hard"), "hard");
        assert.equal(requestedTimeMode("none"), "none");
    });

    it("reads a missing field as none", () => {
        assert.equal(requestedTimeMode(undefined), TIME_MODES.NONE);
        assert.equal(requestedTimeMode(null), TIME_MODES.NONE);
    });

    it("refuses anything else", () => {
        for (const value of ["", "SOFT", "Hard", "off", true, false, 0, 1, {}, ["soft"]]) {
            assert.equal(requestedTimeMode(value), null, JSON.stringify(value));
        }
    });

    it("answers a refusal with a machine-readable code", () => {
        const body = invalidTimeModeRefusal();
        assert.equal(body.status, "err");
        assert.equal(body.code, INVALID_TIME_MODE_CODE);
        assert.equal(body.code, "INVALID_TIME_MODE");
        assert.match(body.message, /none, soft, hard/u);
    });
});

describe("designHasTimedPhase", () => {
    it("is true with at least one valid duration", () => {
        assert.equal(designHasTimedPhase(TIMED), true);
        assert.equal(designHasTimedPhase({ phases: [{ durationMinutes: 1 }] }), true);
    });

    it("is false without a valid duration", () => {
        for (const design of [
            UNTIMED,
            { phases: [] },
            {
                phases: [{ durationMinutes: 0 }, { durationMinutes: "10" }, { durationMinutes: 181 }],
            },
            { phases: "not a list" },
            {},
            null,
            undefined,
        ]) {
            assert.equal(designHasTimedPhase(design), false, JSON.stringify(design));
        }
    });
});

describe("launchTimeMode", () => {
    it("keeps the requested mode for a design with durations", () => {
        assert.equal(launchTimeMode("soft", TIMED), "soft");
        assert.equal(launchTimeMode("hard", TIMED), "hard");
        assert.equal(launchTimeMode("none", TIMED), "none");
    });

    it("stores none for a design without durations, whatever is asked", () => {
        assert.equal(launchTimeMode("soft", UNTIMED), "none");
        assert.equal(launchTimeMode("hard", UNTIMED), "none");
        assert.equal(launchTimeMode("hard", null), "none");
    });

    it("stores none for an unknown mode", () => {
        assert.equal(launchTimeMode("fast", TIMED), "none");
        assert.equal(launchTimeMode(undefined, TIMED), "none");
    });
});

describe("sessionTimeMode", () => {
    it("reads the stored mode", () => {
        assert.equal(sessionTimeMode({ time_mode: "soft" }), "soft");
        assert.equal(sessionTimeMode({ time_mode: "hard" }), "hard");
        assert.equal(sessionTimeMode({ time_mode: "none" }), "none");
    });

    it("reads none for a missing row, column or unknown value", () => {
        for (const row of [null, undefined, {}, { time_mode: null }, { time_mode: "fast" }]) {
            assert.equal(sessionTimeMode(row), "none", JSON.stringify(row));
        }
    });
});

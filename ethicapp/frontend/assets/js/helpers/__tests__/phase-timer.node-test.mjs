// The phase clock in the activity dashboard's bar (#1115, epic #1105): the
// time left from the server's offset, how it reads, the timer's states,
// the thresholds announced, the tick delay and the refusal messages.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    crossedThreshold,
    extendRefusalMessageKey,
    formatClock,
    nextTickDelayMs,
    remainingMs,
    timerState,
    timerView,
    WARNING_MS,
} from "../phase-timer.js";

const LOCAL_NOW = Date.parse("2026-11-11T12:00:00.000Z");

// A kept clock whose server runs `offsetMs` ahead of the local clock.
function keptClock(overrides = {}) {
    return {
        sessionId:   10,
        timeMode:    "soft",
        finished:    false,
        phaseId:     41,
        phaseNumber: 2,
        startedAt:   "2026-11-11T11:50:00.000Z",
        endsAt:      "2026-11-11T12:10:00.000Z",
        isLastPhase: false,
        serverNow:   "2026-11-11T12:00:00.000Z",
        offsetMs:    0,
        receivedAt:  LOCAL_NOW,
        ...overrides,
    };
}

const at = (clock, msLeft) => ({
    ...clock,
    endsAt: new Date(LOCAL_NOW + (clock.offsetMs ?? 0) + msLeft).toISOString(),
});

describe("remainingMs", () => {
    it("counts from the server's time, not the local one", () => {
        assert.equal(remainingMs(keptClock(), LOCAL_NOW), 10 * 60 * 1000);
        // The server is 3 s ahead: 3 s less are left.
        assert.equal(remainingMs(keptClock({ offsetMs: 3000 }), LOCAL_NOW), 10 * 60 * 1000 - 3000);
        // Five minutes in the background change nothing but the time.
        assert.equal(remainingMs(keptClock(), LOCAL_NOW + 5 * 60 * 1000), 5 * 60 * 1000);
    });

    it("goes negative after the deadline and is null without one", () => {
        assert.equal(remainingMs(keptClock(), LOCAL_NOW + 11 * 60 * 1000), -60 * 1000);
        assert.equal(remainingMs(keptClock({ endsAt: null }), LOCAL_NOW), null);
        assert.equal(remainingMs(keptClock({ endsAt: "not a date" }), LOCAL_NOW), null);
        assert.equal(remainingMs(null, LOCAL_NOW), null);
    });
});

describe("formatClock", () => {
    it("reads minutes and seconds, rounding the seconds up", () => {
        assert.equal(formatClock(12 * 60 * 1000 + 34 * 1000), "12:34");
        assert.equal(formatClock(12 * 60 * 1000 + 33 * 1000 + 1), "12:34");
        assert.equal(formatClock(45 * 1000), "00:45");
        assert.equal(formatClock(1), "00:01");
        assert.equal(formatClock(0), "00:00");
    });

    it("reads hours from one hour", () => {
        assert.equal(formatClock(60 * 60 * 1000), "1:00:00");
        assert.equal(formatClock(59 * 60 * 1000 + 59 * 1000), "59:59");
        assert.equal(formatClock((2 * 3600 + 5 * 60 + 7) * 1000), "2:05:07");
        assert.equal(formatClock(180 * 60 * 1000), "3:00:00");
    });

    it("signs the overtime with a real minus sign, never −00:00", () => {
        assert.equal(formatClock(-(2 * 60 + 15) * 1000), "−02:15");
        assert.equal(formatClock(-(2 * 60 + 15) * 1000 - 999), "−02:15");
        assert.equal(formatClock(-1000), "−00:01");
        assert.equal(formatClock(-999), "00:00");
        assert.equal(formatClock(-1), "00:00");
        assert.equal(formatClock(-0), "00:00");
        assert.equal(formatClock(-(3600 + 1) * 1000), "−1:00:01");
        assert.doesNotMatch(formatClock(-500), /-|−/);
    });

    it("reads a value that is not a number as dashes", () => {
        assert.equal(formatClock(null), "--:--");
        assert.equal(formatClock(Number.NaN), "--:--");
        assert.equal(formatClock(Number.POSITIVE_INFINITY), "--:--");
    });
});

describe("timerState", () => {
    const state = (clock, msLeft, options = {}) => timerState(at(clock, msLeft),
        { localNowMs: LOCAL_NOW, ...options });

    it("runs, then warns in the last minute", () => {
        assert.equal(state(keptClock(), 10 * 60 * 1000), "running");
        assert.equal(state(keptClock(), WARNING_MS + 1), "running");
        assert.equal(state(keptClock(), WARNING_MS), "warning");
        assert.equal(state(keptClock(), 1), "warning");
        assert.equal(state(keptClock({ timeMode: "hard" }), 30 * 1000), "warning");
    });

    it("goes into overtime in soft mode", () => {
        assert.equal(state(keptClock(), 0), "overtime");
        assert.equal(state(keptClock(), -135 * 1000), "overtime");
        assert.equal(state(keptClock({ isLastPhase: true }), -1), "overtime");
    });

    it("moves on in hard mode with a next phase, and is up on the last", () => {
        assert.equal(state(keptClock({ timeMode: "hard" }), 0), "advancing");
        assert.equal(state(keptClock({ timeMode: "hard" }), -5000), "advancing");
        assert.equal(state(keptClock({ timeMode: "hard", isLastPhase: true }), 0), "time-up");
        assert.equal(state(keptClock({ timeMode: "hard", isLastPhase: true }), -300 * 1000),
            "time-up");
    });

    it("shows no clock without a mode, a duration, a phase, or once finished", () => {
        assert.equal(state(keptClock({ timeMode: "none" }), 60 * 1000), "none");
        assert.equal(timerState(keptClock({ endsAt: null }), { localNowMs: LOCAL_NOW }), "none");
        assert.equal(timerState(keptClock({ phaseId: null, phaseNumber: null, endsAt: null }),
            { localNowMs: LOCAL_NOW }), "none");
        assert.equal(state(keptClock({ finished: true }), 60 * 1000), "none");
        assert.equal(state(keptClock(), 60 * 1000, { isFinished: true }), "none");
        assert.equal(timerState(null, { localNowMs: LOCAL_NOW }), "none");
    });
});

describe("crossedThreshold", () => {
    it("reports the last minute and the end of the time", () => {
        assert.equal(crossedThreshold(61 * 1000, 60 * 1000), WARNING_MS);
        assert.equal(crossedThreshold(60.5 * 1000, 59.5 * 1000), WARNING_MS);
        assert.equal(crossedThreshold(500, 0), 0);
        assert.equal(crossedThreshold(500, -400), 0);
    });

    it("reports the lowest one after a while in the background", () => {
        assert.equal(crossedThreshold(5 * 60 * 1000, -10 * 1000), 0);
        assert.equal(crossedThreshold(5 * 60 * 1000, 30 * 1000), WARNING_MS);
    });

    it("reports nothing between thresholds, upwards or on a first reading", () => {
        assert.equal(crossedThreshold(10 * 60 * 1000, 9 * 60 * 1000), null);
        assert.equal(crossedThreshold(60 * 1000, 59 * 1000), null);
        assert.equal(crossedThreshold(0, -1000), null);
        // "+1 min" from 00:30 to 01:30.
        assert.equal(crossedThreshold(30 * 1000, 90 * 1000), null);
        assert.equal(crossedThreshold(null, 30 * 1000), null);
        assert.equal(crossedThreshold(30 * 1000, null), null);
    });
});

describe("nextTickDelayMs", () => {
    it("lands just after the shown second changes", () => {
        assert.equal(nextTickDelayMs(5000), 1025);
        assert.equal(nextTickDelayMs(4999.5), 1024.5);
        assert.equal(nextTickDelayMs(4200), 225);
        assert.equal(nextTickDelayMs(0), 1025);
        assert.equal(nextTickDelayMs(-2300), 725);
    });

    it("ticks every second without a time", () => {
        assert.equal(nextTickDelayMs(null), 1000);
        assert.equal(nextTickDelayMs(Number.NaN), 1000);
    });

    it("shows a new value at each tick it schedules", () => {
        let left = 3 * 1000 + 400;
        const shown = [formatClock(left)];
        for (let i = 0; i < 4; i += 1) {
            left -= nextTickDelayMs(left);
            shown.push(formatClock(left));
        }
        assert.deepEqual(shown, ["00:04", "00:03", "00:02", "00:01", "00:00"]);
    });
});

describe("timerView", () => {
    const view = (clock, msLeft, options = {}) => timerView(at(clock, msLeft),
        { localNowMs: LOCAL_NOW, ...options });

    it("shows a soft clock with its digits and minutes for screen readers", () => {
        const running = view(keptClock(), 12 * 60 * 1000 + 34 * 1000);
        assert.equal(running.state, "running");
        assert.equal(running.showDigits, true);
        assert.equal(running.automatic, false);
        assert.equal(running.nextPhaseNumber, null);
        assert.equal(running.canExtend, true);
        assert.deepEqual(running.spoken,
            { key: "phase_timer_sr_remaining_other", params: { count: 13 } });
        assert.equal(running.deadline, `41|${at(keptClock(), 12 * 60 * 1000 + 34 * 1000).endsAt}`);

        assert.deepEqual(view(keptClock(), 45 * 1000).spoken,
            { key: "phase_timer_sr_remaining_one", params: { count: 1 } });
    });

    it("tells the overtime in whole minutes", () => {
        assert.deepEqual(view(keptClock(), -30 * 1000).spoken,
            { key: "phase_timer_sr_time_up", params: {} });
        assert.deepEqual(view(keptClock(), -90 * 1000).spoken,
            { key: "phase_timer_sr_overtime_one", params: { count: 1 } });
        assert.deepEqual(view(keptClock(), -135 * 1000).spoken,
            { key: "phase_timer_sr_overtime_other", params: { count: 2 } });
        assert.equal(view(keptClock(), -135 * 1000).showDigits, true);
        assert.equal(view(keptClock(), -135 * 1000).canExtend, true);
    });

    it("marks a hard clock with a next phase as automatic", () => {
        const hard = keptClock({ timeMode: "hard" });
        const running = view(hard, 5 * 60 * 1000);
        assert.equal(running.automatic, true);
        assert.equal(running.nextPhaseNumber, 3);

        const advancing = view(hard, -2000);
        assert.equal(advancing.state, "advancing");
        assert.equal(advancing.showDigits, false);
        assert.equal(advancing.canExtend, false, "the runner's deadline: the server refuses it");
        assert.deepEqual(advancing.spoken,
            { key: "phase_timer_sr_advancing", params: { number: 3 } });
    });

    it("lets the last phase of a hard clock be extended once its time is up", () => {
        const last = keptClock({ timeMode: "hard", isLastPhase: true });
        assert.equal(view(last, 5 * 60 * 1000).automatic, false);
        const up = view(last, -60 * 1000);
        assert.equal(up.state, "time-up");
        assert.equal(up.showDigits, false);
        assert.equal(up.canExtend, true);
        assert.deepEqual(up.spoken, { key: "phase_timer_sr_time_up", params: {} });
    });

    it("hides everything without a clock", () => {
        const none = timerView(null, { localNowMs: LOCAL_NOW });
        assert.equal(none.state, "none");
        assert.equal(none.showDigits, false);
        assert.equal(none.canExtend, false);
        assert.equal(none.key, "none");
    });

    it("keeps its key while only the seconds change", () => {
        const clock = keptClock();
        const first = timerView(clock, { localNowMs: LOCAL_NOW });
        assert.equal(timerView(clock, { localNowMs: LOCAL_NOW + 20 * 1000 }).key, first.key);
        // A new minute for screen readers, the last minute, a new deadline.
        assert.notEqual(timerView(clock, { localNowMs: LOCAL_NOW + 61 * 1000 }).key, first.key);
        assert.notEqual(timerView(clock, { localNowMs: LOCAL_NOW + 9.5 * 60 * 1000 }).key,
            first.key);
        assert.notEqual(timerView(at(clock, 11 * 60 * 1000), { localNowMs: LOCAL_NOW }).key,
            first.key);
    });
});

describe("extendRefusalMessageKey", () => {
    it("has a message for each refusal and a generic failure", () => {
        assert.equal(extendRefusalMessageKey("DEADLINE_CHANGED"),
            "phase_timer_extend_deadline_changed");
        assert.equal(extendRefusalMessageKey("PHASE_NOT_CURRENT"),
            "phase_timer_extend_phase_changed");
        assert.equal(extendRefusalMessageKey("ACTIVITY_FINISHED"), "phase_timer_extend_finished");
        assert.equal(extendRefusalMessageKey("NO_DEADLINE"), "phase_timer_extend_no_deadline");
        assert.equal(extendRefusalMessageKey("DEADLINE_PASSED"),
            "phase_timer_extend_deadline_passed");
        assert.equal(extendRefusalMessageKey("INVALID_MINUTES"), "phase_timer_extend_failed");
        assert.equal(extendRefusalMessageKey(null), "phase_timer_extend_failed");
        assert.equal(extendRefusalMessageKey("DEADLINE_PASSED", { isLastPhase: false }),
            "phase_timer_extend_deadline_passed");
        assert.equal(extendRefusalMessageKey("DEADLINE_PASSED", { isLastPhase: true }),
            "phase_timer_extend_retry", "the last phase does not move on");
        assert.equal(extendRefusalMessageKey(undefined), "phase_timer_extend_failed");
    });
});

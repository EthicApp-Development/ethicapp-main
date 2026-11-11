// The phase clock in the activity dashboard's bar (#1115, epic #1105).
// Plain functions over the clock that ActivityStateService keeps
// (phase-clock-state.js): the time left, how it reads, the timer's state and
// what the bar shows for it.
//
// The time left is always worked out from the deadline and the server's time
// (the local time plus the clock's offset), never from counted ticks, so it
// is right after the tab spent a while in the background.
//
// States:
// - "none": no clock to show (no time mode, a phase without a duration,
//   before the first phase, or a finished activity);
// - "running": more than a minute left;
// - "warning": the last minute;
// - "overtime": soft mode after 00:00; the teacher sees negative time;
// - "advancing": hard mode after 00:00 with a next phase, which the
//   deadline runner starts;
// - "time-up": hard mode after 00:00 on the last phase, which stays open
//   until the teacher finishes the activity.

import { serverTimeMs } from "./phase-clock-state.js";

export const TIMER_STATES = Object.freeze([
    "none", "running", "warning", "overtime", "advancing", "time-up",
]);

// The last minute, in ms.
export const WARNING_MS = 60 * 1000;

// What a screen reader is told as the clock goes down: one minute left, and
// time up. Lowest last.
export const ANNOUNCED_THRESHOLDS_MS = Object.freeze([WARNING_MS, 0]);

// U+2212, the minus sign.
const MINUS = "−";

// A tick lands this long after the second changes, so it never reads the
// second before.
const TICK_MARGIN_MS = 25;

function timeMs(value) {
    if (typeof value !== "string" || value === "") {
        return null;
    }
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
}

/**
 * The time left before the deadline of a kept clock, in ms, by the server's
 * time; negative once it passed. Null without a deadline.
 *
 * @param {Object|null} phaseClock A kept clock (phase-clock-state.js).
 * @param {number} localNowMs
 * @returns {number|null}
 */
export function remainingMs(phaseClock, localNowMs) {
    const endsAt = timeMs(phaseClock?.endsAt);
    return endsAt === null ? null : endsAt - serverTimeMs(phaseClock, localNowMs);
}

// The whole seconds the clock shows for `ms` left: rounded up, so 00:00
// shows at the deadline and the count goes negative a second later.
function shownSeconds(ms) {
    const seconds = Math.ceil(ms / 1000);
    // Math.ceil(-0.3) is -0, which reads as 0.
    return seconds === 0 ? 0 : seconds;
}

const twoDigits = value => String(value).padStart(2, "0");

/**
 * The clock as the bar shows it: "12:34", "1:02:03" from one hour, and
 * "−02:15" with a real minus sign once the deadline passed. Never "−00:00".
 * "--:--" for a value that is not a number.
 *
 * @param {number} ms The time left, from remainingMs.
 * @returns {string}
 */
export function formatClock(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) {
        return "--:--";
    }
    const seconds = shownSeconds(ms);
    const sign = seconds < 0 ? MINUS : "";
    const total = Math.abs(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    return hours > 0
        ? `${sign}${hours}:${twoDigits(minutes)}:${twoDigits(rest)}`
        : `${sign}${twoDigits(minutes)}:${twoDigits(rest)}`;
}

/**
 * The timer's state for a kept clock, one of TIMER_STATES.
 *
 * @param {Object|null} phaseClock
 * @param {Object} options
 * @param {number} options.localNowMs
 * @param {boolean} [options.isFinished] The dashboard knows the activity
 *   finished, which may come before the clock says so.
 * @returns {string}
 */
export function timerState(phaseClock, { localNowMs, isFinished = false }) {
    const left = remainingMs(phaseClock, localNowMs);
    if (isFinished || !phaseClock || phaseClock.finished === true || !Number(phaseClock.phaseId)
        || !["soft", "hard"].includes(phaseClock.timeMode) || left === null) {
        return "none";
    }
    if (shownSeconds(left) > 0) {
        return left > WARNING_MS ? "running" : "warning";
    }
    if (phaseClock.timeMode === "soft") {
        return "overtime";
    }
    return phaseClock.isLastPhase === true ? "time-up" : "advancing";
}

/**
 * The threshold the clock went past between two readings of the same
 * deadline: WARNING_MS when the last minute began, 0 when time ran out (the
 * lowest one when it went past both, as after a while in the background),
 * or null. Null for a first reading and when the time left went up.
 *
 * @param {number|null} previousMs The time left at the previous reading.
 * @param {number|null} currentMs The time left now.
 * @returns {number|null}
 */
export function crossedThreshold(previousMs, currentMs) {
    if (typeof previousMs !== "number" || typeof currentMs !== "number") {
        return null;
    }
    const crossed = ANNOUNCED_THRESHOLDS_MS.filter(threshold => previousMs > threshold
        && currentMs <= threshold);
    return crossed.length > 0 ? crossed.at(-1) : null;
}

/**
 * How long to wait, in ms, until the clock shows the next second.
 *
 * @param {number|null} ms The time left now.
 * @returns {number}
 */
export function nextTickDelayMs(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) {
        return 1000;
    }
    // The shown second s covers ((s - 1) * 1000, s * 1000]; it changes
    // once the time left reaches (s - 1) * 1000.
    const untilNext = ms - (Math.ceil(ms / 1000) - 1) * 1000;
    return Math.min(1000, Math.max(0, untilNext)) + TICK_MARGIN_MS;
}

// What a screen reader reads for the timer, in whole minutes: the minutes
// left rounded up, or the minutes past the deadline rounded down.
function spokenTime(state, left, nextPhaseNumber) {
    if (state === "running" || state === "warning") {
        const count = Math.max(1, Math.ceil(left / WARNING_MS));
        const key = count === 1 ? "phase_timer_sr_remaining_one" : "phase_timer_sr_remaining_other";
        return { key, params: { count } };
    }
    if (state === "overtime") {
        const count = Math.floor(-left / WARNING_MS);
        if (count === 0) {
            return { key: "phase_timer_sr_time_up", params: {} };
        }
        const key = count === 1 ? "phase_timer_sr_overtime_one" : "phase_timer_sr_overtime_other";
        return { key, params: { count } };
    }
    if (state === "advancing") {
        return { key: "phase_timer_sr_advancing", params: { number: nextPhaseNumber } };
    }
    if (state === "time-up") {
        return { key: "phase_timer_sr_time_up", params: {} };
    }
    return null;
}

/**
 * What the bar shows for a kept clock, but the digits, which the timer
 * writes on every tick (formatClock(view.remainingMs)):
 *
 * - `state`, one of TIMER_STATES;
 * - `deadline`, "phaseId|endsAt", which changes with a new phase or "+1 min";
 * - `remainingMs`, null without a deadline;
 * - `automatic`, hard mode with a next phase, which starts at 00:00;
 * - `nextPhaseNumber`, that phase's number, or null;
 * - `showDigits`, whether the state shows the count;
 * - `canExtend`, whether "+1 min" may be offered;
 * - `spoken`, `{ key, params }` of the screen reader's text, or null;
 * - `key`, a string that changes only when something above but the
 *   remaining time changes, so the bar is redrawn once per change.
 *
 * @param {Object|null} phaseClock
 * @param {Object} options
 * @param {number} options.localNowMs
 * @param {boolean} [options.isFinished]
 * @returns {Object}
 */
export function timerView(phaseClock, { localNowMs, isFinished = false }) {
    const state = timerState(phaseClock, { localNowMs, isFinished });
    if (state === "none") {
        return {
            state,
            deadline:        null,
            remainingMs:     null,
            automatic:       false,
            nextPhaseNumber: null,
            showDigits:      false,
            canExtend:       false,
            spoken:          null,
            key:             "none",
        };
    }

    const left = remainingMs(phaseClock, localNowMs);
    const automatic = phaseClock.timeMode === "hard" && phaseClock.isLastPhase !== true;
    const phaseNumber = Number(phaseClock.phaseNumber);
    const nextPhaseNumber = automatic && Number.isInteger(phaseNumber) ? phaseNumber + 1 : null;
    const spoken = spokenTime(state, left, nextPhaseNumber);
    const view = {
        state,
        deadline:    `${Number(phaseClock.phaseId)}|${phaseClock.endsAt}`,
        remainingMs: left,
        automatic,
        nextPhaseNumber,
        showDigits:  ["running", "warning", "overtime"].includes(state),
        // A hard deadline that passed with a next phase is the runner's to
        // handle; the server refuses to move it (DEADLINE_PASSED).
        canExtend:   state !== "advancing",
        spoken,
    };
    view.key = [view.state, view.deadline, view.automatic, view.nextPhaseNumber,
        spoken?.key, JSON.stringify(spoken?.params ?? {})].join("#");
    return view;
}

// The message for each refusal of "+1 min" (409 codes of POST
// /activities/:id/phases/:phaseId/clock/extend).
const REFUSAL_MESSAGE_KEYS = Object.freeze({
    DEADLINE_CHANGED:  "phase_timer_extend_deadline_changed",
    PHASE_NOT_CURRENT: "phase_timer_extend_phase_changed",
    ACTIVITY_FINISHED: "phase_timer_extend_finished",
    NO_DEADLINE:       "phase_timer_extend_no_deadline",
    DEADLINE_PASSED:   "phase_timer_extend_deadline_passed",
});

/**
 * The translation key that tells the teacher why "+1 min" added nothing;
 * a generic failure for an unknown code or no code (network, 500). A hard
 * deadline that just passed moves the activity on, except on the last
 * phase, where the minute can be added once the server has handled it, a
 * moment later.
 *
 * @param {string|null|undefined} code
 * @param {Object} [options]
 * @param {boolean} [options.isLastPhase] Whether the phase was the last.
 * @returns {string}
 */
export function extendRefusalMessageKey(code, { isLastPhase = false } = {}) {
    if (code === "DEADLINE_PASSED" && isLastPhase) {
        return "phase_timer_extend_retry";
    }
    return REFUSAL_MESSAGE_KEYS[code] ?? "phase_timer_extend_failed";
}

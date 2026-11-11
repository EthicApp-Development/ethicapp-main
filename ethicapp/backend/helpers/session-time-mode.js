// An activity's time mode (#1109, epic #1105), chosen in step 2 of the
// launch wizard and stored once in `sessions.time_mode` (V45):
// - "soft": the teacher moves on by hand, and the teacher's count goes on
//   below 00:00;
// - "hard": at 00:00 the activity moves to the next phase by itself;
// - "none": no clock, as before the epic.
//
// Only phases with a `durationMinutes` (backend/helpers/phase-duration.js)
// have a clock; the others run untimed in any mode. A design without any
// duration therefore launches with "none", whatever the request asks for:
// the wizard does not offer the choice for it, so a mode sent anyway is
// coerced rather than refused.

import { isValidPhaseDuration } from "./phase-duration.js";

export const TIME_MODES = Object.freeze({
    NONE: "none",
    SOFT: "soft",
    HARD: "hard",
});

export const INVALID_TIME_MODE_CODE = "INVALID_TIME_MODE";

const KNOWN_TIME_MODES = new Set(Object.values(TIME_MODES));

/**
 * The time mode a launch request asks for. A missing field (undefined or
 * null) means "none".
 * @param {unknown} timeMode `req.body.timeMode` of `POST /activities`
 * @returns {string|null} the mode, or null when the value is not one
 */
export function requestedTimeMode(timeMode) {
    if (timeMode === undefined || timeMode === null) {
        return TIME_MODES.NONE;
    }
    return KNOWN_TIME_MODES.has(timeMode) ? timeMode : null;
}

/** The 400 answer for a launch request with an unknown time mode. */
export function invalidTimeModeRefusal() {
    return {
        status:  "err",
        code:    INVALID_TIME_MODE_CODE,
        message: `The time mode must be one of: ${[...KNOWN_TIME_MODES].join(", ")}.`,
    };
}

/**
 * Whether a design has at least one phase with a valid duration.
 * @param {object|null|undefined} design a design document (`designs.design`)
 */
export function designHasTimedPhase(design) {
    const phases = Array.isArray(design?.phases) ? design.phases : [];
    return phases.some(phase => isValidPhaseDuration(phase?.durationMinutes));
}

/**
 * The mode a launch stores: the requested one when the design has a timed
 * phase, otherwise "none".
 * @param {string} timeMode a mode accepted by `requestedTimeMode`
 * @param {object|null|undefined} design
 * @returns {string}
 */
export function launchTimeMode(timeMode, design) {
    if (!KNOWN_TIME_MODES.has(timeMode) || !designHasTimedPhase(design)) {
        return TIME_MODES.NONE;
    }
    return timeMode;
}

/**
 * The stored mode of a session row: "none" for a missing row or column (an
 * older query) or an unknown value.
 * @param {{ time_mode?: unknown }|null|undefined} row
 * @returns {string}
 */
export function sessionTimeMode(row) {
    const stored = row?.time_mode;
    return KNOWN_TIME_MODES.has(stored) ? stored : TIME_MODES.NONE;
}

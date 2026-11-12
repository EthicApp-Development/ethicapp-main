// The optional duration of a design phase (#1107, epic #1105):
// `phase.durationMinutes`, whole minutes from 1 to 180. A phase without the
// key has no clock. Turning the duration off deletes the key, so a design
// never stores null or 0. The backend checks the same rule
// (backend/helpers/phase-duration.js).

export const PHASE_DURATION_MIN_MINUTES = 1;
export const PHASE_DURATION_MAX_MINUTES = 180;
export const PHASE_DURATION_DEFAULT_MINUTES = 10;

export function isValidPhaseDuration(value) {
    return Number.isInteger(value)
        && value >= PHASE_DURATION_MIN_MINUTES
        && value <= PHASE_DURATION_MAX_MINUTES;
}

// Whether the teacher has turned the phase's duration on. The key stays while
// the teacher edits the number, even when the field is momentarily empty or
// invalid, so the switch does not turn itself off.
export function isPhaseDurationEnabled(phase) {
    return phase !== null && typeof phase === "object" && Object.hasOwn(phase, "durationMinutes");
}

export function setPhaseDurationEnabled(phase, enabled) {
    if (!phase || typeof phase !== "object") {
        return;
    }
    if (enabled) {
        if (!isValidPhaseDuration(phase.durationMinutes)) {
            phase.durationMinutes = PHASE_DURATION_DEFAULT_MINUTES;
        }
        return;
    }
    delete phase.durationMinutes;
}

// A getter-setter for `ng-model-options="{ getterSetter: true }"`: the editor's
// "Set duration" switch reads and writes the phase through it.
export function phaseDurationSwitch(phase) {
    return function durationSwitch(enabled) {
        if (arguments.length > 0) {
            setPhaseDurationEnabled(phase, enabled === true);
        }
        return isPhaseDurationEnabled(phase);
    };
}

// Translation keys of the phase's duration problems: a present key must hold
// a valid duration.
export function phaseDurationErrors(phase) {
    if (!isPhaseDurationEnabled(phase) || isValidPhaseDuration(phase.durationMinutes)) {
        return [];
    }
    return ["error_phase_duration_invalid"];
}

export function hasInvalidPhaseDuration(phases) {
    return Array.isArray(phases) && phases.some(phase => phaseDurationErrors(phase).length > 0);
}

/**
 * The planned length of a design: the sum of the valid phase durations, and
 * how many of its phases have one.
 *
 * @param {Array<object>} phases
 * @returns {{ totalMinutes: number, timedPhaseCount: number, phaseCount: number }}
 */
export function plannedDesignDuration(phases) {
    const list = Array.isArray(phases) ? phases : [];
    let totalMinutes = 0;
    let timedPhaseCount = 0;
    for (const phase of list) {
        if (isValidPhaseDuration(phase?.durationMinutes)) {
            totalMinutes += phase.durationMinutes;
            timedPhaseCount += 1;
        }
    }
    return { totalMinutes, timedPhaseCount, phaseCount: list.length };
}

// The translation key and values of a planned duration, or null when no
// phase has a duration: "45 min in 3 of 4 phases", or "10 min in 1 phase"
// for a design of one phase.
export function plannedDesignDurationText(phases) {
    const planned = plannedDesignDuration(phases);
    if (planned.timedPhaseCount === 0) {
        return null;
    }
    const values = {
        minutes: planned.totalMinutes,
        timed:   planned.timedPhaseCount,
        total:   planned.phaseCount,
    };
    const key = planned.phaseCount === 1
        ? "design_planned_duration_single_phase"
        : "design_planned_duration_summary";
    return { key, values };
}

// The planned duration as a list of designs shows it, or null when no phase
// has a duration: "45 min" when every phase has one, otherwise
// "30 min in 2 of 3 phases".
export function plannedDurationListText(phases) {
    const planned = plannedDesignDuration(phases);
    if (planned.timedPhaseCount === 0) {
        return null;
    }
    if (planned.timedPhaseCount === planned.phaseCount) {
        return { key: "phase_duration_minutes", values: { minutes: planned.totalMinutes } };
    }
    return plannedDesignDurationText(phases);
}

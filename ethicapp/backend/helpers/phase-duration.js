// The optional duration of a design phase (#1107, epic #1105):
// `phase.durationMinutes`, whole minutes from 1 to 180. A phase without the
// key has no clock. The key is never stored as null or 0, so a present key
// must hold a valid duration. canonical-schemas/ethicapp-v1.schema.json
// describes the same rule.

export const PHASE_DURATION_MIN_MINUTES = 1;
export const PHASE_DURATION_MAX_MINUTES = 180;
export const INVALID_PHASE_DURATION_CODE = "INVALID_PHASE_DURATION";

export function isValidPhaseDuration(value) {
    return Number.isInteger(value)
        && value >= PHASE_DURATION_MIN_MINUTES
        && value <= PHASE_DURATION_MAX_MINUTES;
}

function hasDurationKey(phase) {
    return phase !== null && typeof phase === "object"
        && Object.hasOwn(phase, "durationMinutes");
}

/**
 * The phases of a design whose duration is present but not valid.
 *
 * @param {object} design a design document (`designs.design`)
 * @returns {Array<{ phaseIndex: number }>} 0-based, in design order. Empty
 *   for a design without phases.
 */
export function invalidPhaseDurations(design) {
    const phases = Array.isArray(design?.phases) ? design.phases : [];
    const invalid = [];
    phases.forEach((phase, phaseIndex) => {
        if (hasDurationKey(phase) && !isValidPhaseDuration(phase.durationMinutes)) {
            invalid.push({ phaseIndex });
        }
    });
    return invalid;
}

/**
 * The 400 answer for a design with an invalid phase duration, or null when
 * every duration is valid or absent.
 */
export function phaseDurationRefusal(design) {
    const errors = invalidPhaseDurations(design);
    if (errors.length === 0) {
        return null;
    }
    return {
        status: 400,
        body:   {
            status:  "err",
            code:    INVALID_PHASE_DURATION_CODE,
            message: "A phase duration must be a whole number of minutes from "
                + `${PHASE_DURATION_MIN_MINUTES} to ${PHASE_DURATION_MAX_MINUTES}.`,
            errors,
        },
    };
}

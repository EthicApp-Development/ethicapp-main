// Pure helpers for the tutor's modes in the teacher's views (#865, epic
// #861). The backend decides every mode and its reason (helpers/tutor-mode.js
// in ethicapp/backend); these helpers only pick the texts and the links that
// explain them, in the design view and in the activity view.

export const TUTOR_MODE_ENHANCED = "enhanced";
export const TUTOR_MODE_BASIC = "basic";

// The service whose evaluations these modes describe.
export const ARGUMENTATION_TUTOR_SERVICE_ID = "argumentation-tutor-system";

// What the teacher can do about a reason: open the case (its evidence
// inventory), or generate the claim typology again.
export const TUTOR_MODE_ACTIONS = Object.freeze({
    OPEN_CASE:         "open-case",
    GENERATE_TYPOLOGY: "generate-typology",
});

const { OPEN_CASE, GENERATE_TYPOLOGY } = TUTOR_MODE_ACTIONS;

// Each reason of the backend (TUTOR_MODE_REASONS in helpers/tutor-mode.js)
// with its text and the action that helps, if any.
const REASONS = Object.freeze({
    "inventory-disabled":   { key: "tutor_mode_reason_inventory_disabled", action: null },
    "inventory-failed":     { key: "tutor_mode_reason_inventory_failed", action: OPEN_CASE },
    "no-inventory":         { key: "tutor_mode_reason_no_inventory", action: OPEN_CASE },
    "typology-disabled":    { key: "tutor_mode_reason_typology_disabled", action: null },
    "typology-pending":     { key: "tutor_mode_reason_typology_pending", action: null },
    "typology-failed":      { key: "tutor_mode_reason_typology_failed", action: GENERATE_TYPOLOGY },
    "typology-out-of-date": {
        key:    "tutor_mode_reason_typology_out_of_date",
        action: GENERATE_TYPOLOGY,
    },
    "no-typology":       { key: "tutor_mode_reason_no_typology", action: GENERATE_TYPOLOGY },
    "tutor-unsupported": { key: "tutor_mode_reason_tutor_unsupported", action: null },
    "context-rejected":  { key: "tutor_mode_reason_context_rejected", action: null },
});

const UNKNOWN_REASON = Object.freeze({ key: "tutor_mode_reason_unknown", action: null });

// Why the claim typology covers no question (NO_UNITS_REASONS in the
// backend's design-analysis-units.js).
const UNITS_REASON_KEYS = Object.freeze({
    "not-applicable":     "claim_typology_units_not_applicable",
    "no-consumer":        "claim_typology_units_no_consumer",
    "consumers-unusable": "claim_typology_units_consumers_unusable",
    "no-questions":       "claim_typology_units_no_questions",
});

function reasonOf(reason) {
    return Object.hasOwn(REASONS, reason) ? REASONS[reason] : UNKNOWN_REASON;
}

/** The translation key that explains a basic-mode reason. */
export function tutorModeReasonKey(reason) {
    return reasonOf(reason).key;
}

/**
 * What the design view says about a tutor question's expected mode, from the
 * backend's `{ mode, reason }`: `{ enhanced, reasonKey, action }`, or null
 * when the backend gave none (the tutor is not a usable consumer).
 */
export function tutorModeNote(tutorMode) {
    if (!tutorMode || typeof tutorMode !== "object") {
        return null;
    }
    if (tutorMode.mode === TUTOR_MODE_ENHANCED) {
        return { enhanced: true, reasonKey: null, action: null };
    }

    const { key, action } = reasonOf(tutorMode.reason);
    return { enhanced: false, reasonKey: key, action };
}

/** The translation key that explains why the typology covers no question, or null. */
export function claimTypologyUnitsReasonKey(reason) {
    return Object.hasOwn(UNITS_REASON_KEYS, reason) ? UNITS_REASON_KEYS[reason] : null;
}

/**
 * The tutor questions of one phase whose sessions run in the basic mode, for
 * the activity view's warnings: from the records of
 * `GET /activities/:id/tutor-modes`, ordered by question number.
 *
 * @returns {Array<{questionKey: string, questionNumber: number|null, reasonKey: string}>}
 */
export function basicTutorSessions(records, phaseId) {
    const phase = Number(phaseId);
    return (Array.isArray(records) ? records : [])
        .filter(record => Number(record?.phaseId) === phase
            && record.tutorMode === TUTOR_MODE_BASIC)
        .map(record => ({
            questionKey:    record.questionKey ?? "",
            questionNumber: Number.isInteger(record.questionNumber) ? record.questionNumber : null,
            reasonKey:      tutorModeReasonKey(record.tutorModeReason),
        }))
        .sort((a, b) => (a.questionNumber ?? Infinity) - (b.questionNumber ?? Infinity));
}

/**
 * Whether a teacher socket event announces an instantiation of the tutor in
 * the given phase (`onExternalServiceInstantiated`, #865).
 */
export function announcesTutorSession(event, phaseId) {
    return event?.serviceId === ARGUMENTATION_TUTOR_SERVICE_ID
        && Number(event?.phaseId) === Number(phaseId);
}

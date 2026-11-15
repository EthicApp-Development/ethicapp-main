// The case inputs a design's services require (#1220), as the design editor
// shows them next to each service's configuration. The server's validator
// (POST /designs/case-inputs, services/case-input-validation.service.js)
// decides everything; these helpers only arrange its answer for the view.

export const CASE_INPUT_STATUSES = Object.freeze([
    "ready",
    "absent",
    "pending",
    "failed",
    "not_reviewed",
]);

// How long the editor waits after the last change before it asks again.
export const CASE_INPUT_CHECK_DELAY_MS = 400;

function phasesOf(design) {
    return Array.isArray(design?.phases) ? design.phases : [];
}

/**
 * What the validator's answer depends on in the editor: the design's case
 * and each phase's services and their settings. The editor asks again when
 * it changes. Null without a design, and when no phase enables a service,
 * since nothing can be required then.
 * @param {Object|null} design
 * @returns {string|null}
 */
export function caseInputsRequestKey(design) {
    const services = phasesOf(design).map(phase => phase?.externalServices ?? null);
    const enablesAny = services.some(entry => Array.isArray(entry?.enabledServiceIds)
        && entry.enabledServiceIds.length > 0);
    if (!design || !enablesAny) {
        return null;
    }
    return JSON.stringify({ caseId: design.caseId ?? null, services });
}

/**
 * The name of the case analysis an input needs: the label, in `language`, of
 * the first case service that produces it, else its document schema.
 * @param {{ documentSchema: string, analysisServiceIds?: string[] }} input
 * @param {Object[]} caseServices - Case-scope services of the catalog.
 * @param {string} language - `es_CL` or `en_US`.
 * @returns {string}
 */
export function caseAnalysisLabel(input, caseServices, language) {
    const ids = Array.isArray(input?.analysisServiceIds) ? input.analysisServiceIds : [];
    const services = Array.isArray(caseServices) ? caseServices : [];
    for (const id of ids) {
        const service = services.find(candidate => candidate?.id === id);
        const label = service?.ui?.translations?.[language]?.label || service?.descriptor?.name;
        if (label) {
            return label;
        }
    }
    return input?.documentSchema ?? "";
}

/**
 * The validator's inputs arranged per phase object and service, as notices
 * the view renders: `{ key, status, ready, analysisLabel, messageKey }`. The
 * phases are those of the design the answer was asked for, so the notices
 * follow their phase when phases move. Unknown statuses are left out.
 * @param {Object[]} inputs - `result.inputs` of the validator.
 * @param {Object[]} phases - The design's phases when the answer was asked.
 * @param {(input: Object) => string} labelOf - caseAnalysisLabel() bound.
 * @returns {Map<Object, Object<string, Object[]>>}
 */
export function caseInputNoticesByPhase(inputs, phases, labelOf) {
    const notices = new Map();
    for (const input of Array.isArray(inputs) ? inputs : []) {
        const phase = phases?.[input?.phaseIndex];
        if (!phase || !CASE_INPUT_STATUSES.includes(input.status)) {
            continue;
        }
        const byService = notices.get(phase) || {};
        byService[input.serviceId] = [...(byService[input.serviceId] || []), {
            key:           input.key,
            status:        input.status,
            ready:         input.status === "ready",
            analysisLabel: labelOf(input),
            messageKey:    `design_case_input_${input.status}`,
        }];
        notices.set(phase, byService);
    }
    return notices;
}

/**
 * Whether a phase start was refused because a service of the phase needs a
 * case analysis that is not ready (422 MISSING_CASE_INPUTS, #1220).
 * @param {unknown} error - The rejected request.
 * @returns {boolean}
 */
export function isMissingCaseInputsError(error) {
    return error?.status === 422 && error?.data?.code === "MISSING_CASE_INPUTS";
}

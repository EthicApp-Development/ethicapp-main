// The case form's AI analysis options (#650, epic #647): pure helpers for the
// teacher case creation form. The teacher turns analysis on and picks the
// case-scoped services (`GET /external-services?scope=case`) that analyse the
// case. Editing a case never offers the choice; the case view's "Add
// analysis" dialog (#1039) offers the same options, without the switch, for
// the services the case has not chosen.
//
// The form model keeps `analysisEnabled` (the switch) and
// `analysisSelection`, a map of service id to a boolean.

/** The scope of the services the case form offers. */
export const CASE_ANALYSIS_SCOPE = "case";

/**
 * The options' mode for the "Add analysis" dialog: no switch, the services
 * are listed at once and choosing none blocks the confirmation.
 */
export const CASE_ANALYSIS_OPTIONS_MODE_ADD = "add";

const SAVE_ERROR_KEYS = Object.freeze({
    CASE_ANALYSIS_SERVICE_INVALID: "case_analysis_save_invalid",
});

function selectionOf(formModel) {
    const selection = formModel?.analysisSelection;
    return selection && typeof selection === "object" ? selection : {};
}

/**
 * The ids of the services chosen in the form, in the order they were listed
 * (`services`), or in selection order without a list. Empty when the switch
 * is off, so turning it off drops the choice without clearing the boxes.
 */
export function selectedCaseAnalysisServiceIds(formModel, services = null) {
    if (formModel?.analysisEnabled !== true) {
        return [];
    }

    const selection = selectionOf(formModel);
    const candidateIds = Array.isArray(services)
        ? services.map(service => service?.id)
        : Object.keys(selection);

    return candidateIds.filter(id => typeof id === "string" && selection[id] === true);
}

/** Whether the switch is on with no service chosen, which blocks the save. */
export function hasMissingCaseAnalysisSelection(formModel) {
    return formModel?.analysisEnabled === true
        && selectedCaseAnalysisServiceIds(formModel).length === 0;
}

/**
 * Keeps only the choices of services still offered, so a service that stopped
 * being usable is never sent.
 */
export function pruneCaseAnalysisSelection(selection, services) {
    const offeredIds = new Set((Array.isArray(services) ? services : [])
        .map(service => service?.id));

    return Object.fromEntries(Object.entries(selection && typeof selection === "object"
        ? selection
        : {})
        .filter(([id, chosen]) => chosen === true && offeredIds.has(id)));
}

/**
 * The `analysisServiceIds` field the case API takes, as JSON, or null when
 * nothing is chosen. The API then creates the case without analyses.
 */
export function caseAnalysisServiceIdsPayload(formModel) {
    const serviceIds = selectedCaseAnalysisServiceIds(formModel);
    return serviceIds.length > 0 ? JSON.stringify(serviceIds) : null;
}

function serviceTranslations(service, language) {
    return service?.ui?.translations?.[language] || null;
}

/** A service's name in `language`, from its UI translations, else its id. */
export function caseAnalysisServiceLabel(service, language) {
    return serviceTranslations(service, language)?.label
        || service?.descriptor?.name
        || service?.id
        || "";
}

/** A service's description in `language`, or an empty string. */
export function caseAnalysisServiceDescription(service, language) {
    return serviceTranslations(service, language)?.description || "";
}

/** Whether the service's descriptor says it uses an AI language model. */
export function caseAnalysisServiceUsesLlm(service) {
    return service?.descriptor?.usesLlm === true;
}

/** The translation key of a refused analysis choice, or null for other errors. */
export function caseAnalysisSaveErrorKey(error) {
    const code = error?.data?.code;
    return Object.hasOwn(SAVE_ERROR_KEYS, code ?? "") ? SAVE_ERROR_KEYS[code] : null;
}

/**
 * The services the "Add analysis" dialog offers (#1039): the usable
 * case-scoped `services`, in their order, without those already chosen for
 * the case (`chosenServiceIds`, the service ids of GET /cases/:id/analyses).
 */
export function caseAnalysisServicesToAdd(services, chosenServiceIds) {
    const chosenIds = new Set(Array.isArray(chosenServiceIds) ? chosenServiceIds : []);

    return (Array.isArray(services) ? services : [])
        .filter(service => typeof service?.id === "string" && !chosenIds.has(service.id));
}

/** The translation key of a failed "Add analysis" request. */
export function caseAnalysisAddErrorKey(error) {
    return caseAnalysisSaveErrorKey(error) ?? "case_analysis_add_failed";
}

// Translation key for a failed design save:
// - 409 DESIGN_LOCKED: the design is used by an activity (#730);
// - 400 INVALID_SERVICE_CONFIGURATION: an external service setting does not
//   match the service's capability descriptor (#731);
// - 404 CASE_NOT_AVAILABLE: the selected case can no longer be associated
//   (#924);
// - 400 INVALID_PHASE_DURATION: a phase duration is not a whole number of
//   minutes from 1 to 180 (#1107);
// - 400 MISSING_CASE_INPUTS: a service needs a case analysis that is not
//   ready (#1220);
// - anything else is a generic failure.
export function designSaveErrorMessageKey(error) {
    const code = error?.data?.code;
    if (error?.status === 409 && code === "DESIGN_LOCKED") {
        return "save_design_locked";
    }
    if (error?.status === 400 && code === "INVALID_SERVICE_CONFIGURATION") {
        return "save_design_invalid_service_settings";
    }
    if (error?.status === 400 && code === "INVALID_PHASE_DURATION") {
        return "save_design_invalid_phase_duration";
    }
    if (isMissingCaseInputsSaveError(error)) {
        return "save_design_missing_case_inputs";
    }
    if (isCaseNotAvailableError(error)) {
        return "save_design_case_not_available";
    }

    return "save_design_failure";
}

// Whether the save was refused because of its case (#924): the case does not
// exist, was archived, or is another teacher's private case. The editor then
// clears the case, so the teacher can pick another one or save without one.
export function isCaseNotAvailableError(error) {
    return error?.status === 404 && error?.data?.code === "CASE_NOT_AVAILABLE";
}

// Whether the save was refused because a service of the design needs a case
// analysis that is not ready (#1220). The editor then shows the errors next
// to each service's configuration.
export function isMissingCaseInputsSaveError(error) {
    return error?.status === 400 && error?.data?.code === "MISSING_CASE_INPUTS";
}

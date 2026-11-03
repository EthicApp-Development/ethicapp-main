// "New design with this case" (#1019, epic #1008): the design creation form
// opened with a case already chosen, `#!/designs/new?caseId=<id>`, from the
// "My cases" row menu, the "Shared by others" rows and the case view.
//
// The form loads the case with GET /cases/:id, which also answers for cases
// the teacher may read but not associate (an archived case, another
// teacher's private case read through a design). So the form preselects the
// case only when it meets the rule of `associableCaseSql`
// (backend/helpers/design-case-association.js): not archived, and the
// teacher's own or public. `POST /designs` checks the case again (#924).

export const NEW_DESIGN_CASE_PARAM = "caseId";

const NEW_DESIGN_PATH = "/designs/new";

// Why the form did not preselect the case of the URL.
export const NEW_DESIGN_CASE_ARCHIVED = "design_new_from_case_archived";
export const NEW_DESIGN_CASE_NOT_AVAILABLE = "design_new_from_case_not_available";
export const NEW_DESIGN_CASE_LOAD_FAILED = "design_new_from_case_load_failed";

// A positive integer, or a string of digits that is one; null otherwise.
function caseIdOf(value) {
    const id = typeof value === "string" && /^[0-9]{1,15}$/u.test(value) ? Number(value) : value;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The form's route with the case, or null for an invalid id. */
export function newDesignFromCasePath(caseId) {
    const id = caseIdOf(caseId);
    return id === null ? null : `${NEW_DESIGN_PATH}?${NEW_DESIGN_CASE_PARAM}=${id}`;
}

/** The form's link with the case, or null for an invalid id. */
export function newDesignFromCaseHref(caseId) {
    const path = newDesignFromCasePath(caseId);
    return path === null ? null : `#!${path}`;
}

/**
 * The case the URL asks for (`?caseId=`): `requested` when the parameter is
 * there, and its id, null when it is not a positive integer.
 * @returns {{ requested: boolean, caseId: number|null }}
 */
export function requestedCaseFromSearch(search) {
    const value = search?.[NEW_DESIGN_CASE_PARAM];
    if (value === undefined || value === null || value === true || value === "") {
        return { requested: false, caseId: null };
    }
    return { requested: true, caseId: caseIdOf(value) };
}

/**
 * Whether the teacher may associate the case with a design, as
 * `associableCaseSql` decides: it is not archived, and it is theirs or it is
 * public.
 * @param {object} caseItem - GET /cases/:id.
 * @param {number|string|null} teacherId - The id of the teacher's profile.
 */
export function isCaseAssociable(caseItem, teacherId) {
    if (!caseItem || caseItem.archived === true) {
        return false;
    }
    const teacher = caseIdOf(teacherId);
    const isOwn = teacher !== null && caseIdOf(caseItem.creator) === teacher;
    return isOwn || caseItem.visibility === "public";
}

/**
 * Why the form does not preselect the case, as a translation key, or null
 * when it does. Only the teacher's own archived case is named as archived;
 * another teacher's case gets the same answer whether it is archived,
 * private or missing, as the server does.
 */
export function newDesignCaseRefusalKey(caseItem, teacherId) {
    if (isCaseAssociable(caseItem, teacherId)) {
        return null;
    }
    const teacher = caseIdOf(teacherId);
    const isOwn = teacher !== null && caseIdOf(caseItem?.creator) === teacher;
    return isOwn && caseItem?.archived === true
        ? NEW_DESIGN_CASE_ARCHIVED
        : NEW_DESIGN_CASE_NOT_AVAILABLE;
}

/**
 * Why loading the case failed, as a translation key: an invalid id (400) or
 * a case the teacher cannot read (404) is not available; anything else is a
 * failed load.
 */
export function newDesignCaseLoadErrorKey(error) {
    return error?.status === 400 || error?.status === 404
        ? NEW_DESIGN_CASE_NOT_AVAILABLE
        : NEW_DESIGN_CASE_LOAD_FAILED;
}

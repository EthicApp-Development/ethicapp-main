// Whether a teacher may copy a design's case, the rule behind importing and
// duplicating a design (POST /designs/:id/duplicate) and behind the
// `importable` flag of the design list (GET /designs, #974, epic #966).
//
// Copying a design copies its case too (`copyCaseForUser` in
// controllers/designs.js). A teacher may copy a case they created, or a public
// case that is not archived. When the case cannot be copied, the import is
// refused with `DESIGN_CASE_NOT_IMPORTABLE`; the list flags the same designs
// beforehand, so the page can disable "Import" and say why. Both read this one
// rule, so they cannot drift.

import { isPublicVisibility } from "./sharing-policy-helper.js";

function sameId(left, right) {
    return left !== null && left !== undefined && Number(left) === Number(right);
}

/**
 * @param {{creator: *, visibility: *, archived: *}|null|undefined} sourceCase -
 *     The case's `creator`, `visibility` and `archived` columns; null or
 *     undefined when the case was not found.
 * @param {number|string} userId - The teacher who would copy it.
 * @returns {boolean} true when the teacher created the case, or the case is
 *     public and not archived.
 */
export function isCaseCopyableBy(sourceCase, userId) {
    if (!sourceCase) {
        return false;
    }
    if (sameId(sourceCase.creator, userId)) {
        return true;
    }
    return isPublicVisibility(sourceCase.visibility) && sourceCase.archived !== true;
}

/**
 * Whether importing a listed design would succeed as far as its case goes,
 * that is, would not be refused with `DESIGN_CASE_NOT_IMPORTABLE`.
 *
 * @param {object} row - A row of the GET /designs query: `case_id`, and from
 *     the joined case `case_found` (false when the case row is missing),
 *     `case_creator`, `case_visibility` and `case_archived`.
 * @param {number|string} userId - The teacher who would import it.
 * @returns {boolean} true for a design without a case, which copies no case.
 */
export function isListedDesignImportableBy(row, userId) {
    if (row?.case_id === null || row?.case_id === undefined) {
        return true;
    }
    return isCaseCopyableBy(row.case_found === true ? {
        creator:    row.case_creator,
        visibility: row.case_visibility,
        archived:   row.case_archived,
    } : null, userId);
}

// The status of a case in the cases table (#1011, epic #1008), and the
// teacher's imported copy of a case another teacher shares.
//
// Plain functions over the payloads of GET /cases, so the page's controller
// only wires them to the table.
//
// A case's status is one of, in this order of precedence:
// - "in-use": an activity was launched from a design that uses the case
//   (`usage.activityCount`). Its content cannot be edited, nor the case
//   deleted, whatever the state of its PDF, so "in use" wins over "PDF error":
//   the teacher could not replace the PDF anyway.
// - "pdf-error": rendering its PDF into pages failed; students see the PDF.
// - "processing": the render job is pending (queued, or waiting to retry) or
//   being processed.
// - "ready": anything else, including a case without a render job. Every case
//   has a PDF (`ethical_cases.pdf_path` is NOT NULL and POST /cases requires
//   one), but cases created before render jobs existed, a copy whose PDF could
//   not be copied, and a case whose job could not be queued have none. They
//   are shown with their PDF, which is the viewers' fallback for unrendered
//   cases, and nothing failed that the teacher could fix.
// `shared` and `archived` are flags beside the status, not statuses: an
// archived case keeps its status in the Archived tab.
//
// GET /cases returns `usage` only for the teacher's own and archived cases. A
// case without it (the cases other teachers share) is never "in-use" here:
// its status describes its document only.

export const CASE_STATUS_READY = "ready";
export const CASE_STATUS_PROCESSING = "processing";
export const CASE_STATUS_PDF_ERROR = "pdf-error";
export const CASE_STATUS_IN_USE = "in-use";

// The render job statuses of pdf_render_jobs.
const RENDER_FAILED = "failed";
const RENDER_ACTIVE_STATUSES = new Set(["pending", "processing"]);

function caseIdOf(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function countOf(value) {
    const count = Number(value);
    return Number.isInteger(count) && count > 0 ? count : 0;
}

/**
 * The status of a case and the flags beside it.
 *
 * @param {object} caseItem - A case of GET /cases.
 * @returns {{
 *   status: "ready"|"processing"|"pdf-error"|"in-use",
 *   activityCount: number,
 *   shared: boolean,
 *   archived: boolean,
 * }} `activityCount` is the number of activities launched from the designs
 *   that use the case, and 0 when the payload has no `usage`.
 */
export function deriveCaseStatus(caseItem) {
    const activityCount = countOf(caseItem?.usage?.activityCount);
    const renderStatus = caseItem?.documentProcessing?.status;

    let status = CASE_STATUS_READY;
    if (activityCount > 0) {
        status = CASE_STATUS_IN_USE;
    } else if (renderStatus === RENDER_FAILED) {
        status = CASE_STATUS_PDF_ERROR;
    } else if (RENDER_ACTIVE_STATUSES.has(renderStatus)) {
        status = CASE_STATUS_PROCESSING;
    }

    return {
        status,
        activityCount,
        shared:   caseItem?.visibility === "public" || caseItem?.public === true,
        archived: caseItem?.archived === true,
    };
}

function isPreferredCopy(candidate, current) {
    if (!current) {
        return true;
    }
    // An active copy beats an archived one; then the newest.
    const activeCandidate = candidate.archived !== true;
    const activeCurrent = current.archived !== true;
    if (activeCandidate !== activeCurrent) {
        return activeCandidate;
    }
    return (caseIdOf(candidate.id) ?? 0) > (caseIdOf(current.id) ?? 0);
}

/**
 * Shared case id → the teacher's copy of it: a case whose `importedFromCaseId`
 * is that id. Pass the teacher's own and archived cases together. When there
 * are several, an active copy is preferred, then the newest.
 *
 * Only `importedFromCaseId` is read. `originalCaseId` names the root of a
 * chain of copies, so a copy of another teacher's copy would otherwise count
 * as an import of the root case too. A duplicate of the teacher's copy points
 * at that copy, not at the shared case, and a copy whose source was deleted
 * has a null link and matches nothing.
 * @param {object[]} ownCases
 * @returns {Map<number, object>}
 */
export function importedCopiesBySource(ownCases) {
    const copies = new Map();
    for (const caseItem of Array.isArray(ownCases) ? ownCases : []) {
        const sourceId = caseIdOf(caseItem?.importedFromCaseId);
        if (sourceId === null || sourceId === caseIdOf(caseItem.id)) {
            continue;
        }
        if (isPreferredCopy(caseItem, copies.get(sourceId))) {
            copies.set(sourceId, caseItem);
        }
    }
    return copies;
}

/**
 * The teacher's copy of a shared case, or null.
 * @param {object} sharedCase - A case of GET /cases?scope=public.
 * @param {Map<number, object>} copies - From `importedCopiesBySource`.
 */
export function findImportedCopy(sharedCase, copies) {
    return copies?.get(caseIdOf(sharedCase?.id)) || null;
}

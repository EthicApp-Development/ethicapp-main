// Feedback for the Cases page's actions (#1017, epic #1008): what the delete
// confirmation says, and the notices that follow a duplicate, an archive, a
// restore, a delete or an import, or say why one failed.
//
// The notices are the Designs page's (`design-action-feedback.js`, #978):
// plain data with a message key and its parameters, a tone, and the links
// they offer. A case notice's links carry the case's id as `caseId`. The
// page shows one notice at a time, for `NOTICE_TIMEOUT_MS`, and the teacher
// can dismiss it.

import {
    NOTICE_ACTION_EDIT_COPY,
    NOTICE_ACTION_SHOW_IN_MINE,
    NOTICE_ACTION_UNDO_ARCHIVE,
    failureNotice,
    titledNotice,
} from "./design-action-feedback.js";
import { CASE_STATUS_IN_USE, CASE_STATUS_READY } from "./case-status.js";
import { deleteBlockReason } from "./cases-table.js";

export {
    DELETE_CHOICE_ARCHIVE,
    DELETE_CHOICE_CANCEL,
    DELETE_CHOICE_DELETE,
    NOTICE_ACTION_EDIT_COPY,
    NOTICE_ACTION_SHOW_IN_MINE,
    NOTICE_ACTION_UNDO_ARCHIVE,
    NOTICE_TIMEOUT_MS,
    NOTICE_TONE_DANGER,
    NOTICE_TONE_SUCCESS,
    deleteChoiceOf,
} from "./design-action-feedback.js";

function countOf(value) {
    const count = Number(value);
    return Number.isInteger(count) && count > 0 ? count : 0;
}

function hasId(id) {
    return id !== null && id !== undefined;
}

/** A case's title, or "" when the case or its title is missing. */
export function caseTitle(caseItem) {
    const title = caseItem?.title;
    return typeof title === "string" ? title.trim() : "";
}

/** The title of the case with this id among `cases`, or "". */
export function findCaseTitle(cases, id) {
    const caseItem = Array.isArray(cases) ? cases.find(item => item?.id === id) : null;
    return caseTitle(caseItem);
}

// The delete dialog

/**
 * The teacher's own designs that lose their case when it is deleted, from
 * GET /cases/:id/uses: `{ id, title, archived }`, the title null when the
 * design has none.
 */
export function designsLosingCase(uses) {
    const designs = Array.isArray(uses?.ownDesigns) ? uses.ownDesigns : [];
    return designs
        .filter(design => hasId(design?.id))
        .map(design => ({
            id:       design.id,
            title:    (typeof design.title === "string" && design.title.trim()) || null,
            archived: design.archived === true,
        }));
}

/**
 * Why the server would refuse to delete the case, from GET /cases/:id/uses,
 * or null: an activity was launched from a design that uses it, or other
 * teachers' designs keep it (`designsKeepingAccess`, the count behind
 * `CASE_USED_BY_OTHER_TEACHERS`). Worded as the row menu's reason.
 * @returns {{ key: string, params: object }|null}
 */
export function deleteRefusalOf(uses) {
    const activityCount = countOf(uses?.activityCount);
    const keeping = countOf(uses?.designsKeepingAccess);
    if (activityCount === 0 && keeping === 0) {
        return null;
    }
    return deleteBlockReason(
        { status: activityCount > 0 ? CASE_STATUS_IN_USE : CASE_STATUS_READY, activityCount },
        { otherDesignCount: keeping, otherTeacherCount: uses?.otherTeacherCount }
    );
}

// Notices

/** "Created "<copy>"", with "Edit copy". */
export function duplicateNotice(copyId, copyTitle) {
    const actions = hasId(copyId)
        ? [{ id: NOTICE_ACTION_EDIT_COPY, key: "cases_notice_edit_copy", caseId: copyId }]
        : [];
    return titledNotice("cases_notice_duplicated", copyTitle, { actions });
}

/**
 * After an import: "Created "<copy>" in My cases", with "Edit copy" and
 * "View in My cases".
 */
export function importNotice(copyId, copyTitle) {
    const actions = hasId(copyId)
        ? [
            { id: NOTICE_ACTION_EDIT_COPY, key: "cases_notice_edit_copy", caseId: copyId },
            { id: NOTICE_ACTION_SHOW_IN_MINE, key: "cases_notice_show_in_mine", caseId: copyId },
        ]
        : [];
    return titledNotice("cases_notice_imported", copyTitle, { actions });
}

/** "Archived "<title>"", with "Undo", which restores it. */
export function archiveNotice(caseId, title) {
    return titledNotice("cases_notice_archived", title, {
        actions: [{ id: NOTICE_ACTION_UNDO_ARCHIVE, key: "cases_notice_undo", caseId }],
    });
}

/** "Restored "<title>"". */
export function restoreNotice(title) {
    return titledNotice("cases_notice_restored", title);
}

/** "Deleted "<title>"". */
export function deleteNotice(title) {
    return titledNotice("cases_notice_deleted", title);
}

// The coded refusals of DELETE /cases/:id (#1022).
const DELETE_FAILURE_KEYS = {
    CASE_NOT_FOUND:                 "cases_notice_delete_not_found",
    CASE_USED_BY_LAUNCHED_ACTIVITY: "cases_notice_delete_used_by_activity",
    CASE_USED_BY_OTHER_TEACHERS:    "cases_notice_delete_used_by_other_teachers",
};

/** Whether a failed delete means the page's lists were stale. */
export function isCodedDeleteRefusal(error) {
    return Object.hasOwn(DELETE_FAILURE_KEYS, String(error?.data?.code));
}

/**
 * Why a delete failed: the case is gone (404 `CASE_NOT_FOUND`), an activity
 * uses it or other teachers' designs do (the 409s), or a generic failure.
 */
export function deleteFailureNotice(error) {
    const code = String(error?.data?.code);
    return failureNotice(Object.hasOwn(DELETE_FAILURE_KEYS, code)
        ? DELETE_FAILURE_KEYS[code]
        : "cases_notice_delete_failed");
}

export function duplicateFailureNotice() {
    return failureNotice("cases_notice_duplicate_failed");
}

export function archiveFailureNotice() {
    return failureNotice("cases_notice_archive_failed");
}

export function restoreFailureNotice() {
    return failureNotice("cases_notice_restore_failed");
}

/**
 * Why an import failed: the case stopped being shared (403
 * `CASE_NOT_IMPORTABLE`), or a generic failure.
 */
export function importFailureNotice(error) {
    return failureNotice(error?.data?.code === "CASE_NOT_IMPORTABLE"
        ? "cases_notice_import_not_importable"
        : "cases_notice_import_failed");
}

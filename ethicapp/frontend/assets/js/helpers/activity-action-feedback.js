// Feedback for the Activities page's actions (#1052, epic #1046): the notices
// that follow "Copiar código", an archive and a restore, or say why one
// failed.
//
// The notices are the Designs page's (`design-action-feedback.js`, #978):
// plain data with a message key and its parameters, a tone, and the links
// they offer. An activity notice's links carry the session's id as
// `sessionId`. The page shows one notice at a time, for `NOTICE_TIMEOUT_MS`,
// and the teacher can dismiss it. The title is the row's ("<name> ·
// <description>"), and the page translates it as plain text. The notices say
// nothing about participants: archiving changes nothing for them.

import {
    NOTICE_ACTION_UNDO_ARCHIVE,
    NOTICE_TONE_SUCCESS,
    failureNotice,
    titledNotice,
} from "./design-action-feedback.js";

export {
    NOTICE_ACTION_UNDO_ARCHIVE,
    NOTICE_TIMEOUT_MS,
    NOTICE_TONE_DANGER,
    NOTICE_TONE_SUCCESS,
} from "./design-action-feedback.js";

/** Links that open another tab of the page. */
export const NOTICE_ACTION_SHOW_ARCHIVED = "show-archived";
export const NOTICE_ACTION_SHOW_FINISHED = "show-finished";

/** The server's refusal to archive an activity that is not finished. */
export const ACTIVITY_NOT_FINISHED = "ACTIVITY_NOT_FINISHED";

/** "Código copiado". */
export function codeCopiedNotice() {
    return {
        messageKey: "activities_notice_code_copied",
        params:     {},
        tone:       NOTICE_TONE_SUCCESS,
        actions:    [],
    };
}

/** The browser did not let the page copy the code. */
export function copyFailureNotice() {
    return failureNotice("activities_notice_copy_failed");
}

/**
 * "Se archivó "<title>"", with "Deshacer", which restores it, and "Ver
 * Archivadas" unless the page is already there.
 */
export function archiveNotice(sessionId, title, { showArchived = true } = {}) {
    const actions = [{
        id: NOTICE_ACTION_UNDO_ARCHIVE, key: "activities_notice_undo", sessionId, title,
    }];
    if (showArchived) {
        actions.push({
            id: NOTICE_ACTION_SHOW_ARCHIVED, key: "activities_notice_show_archived", sessionId,
        });
    }
    return titledNotice("activities_notice_archived", title, { actions });
}

/**
 * "Se restauró "<title>"", with "Ver en Terminadas" unless the page is
 * already there, as after "Deshacer".
 */
export function restoreNotice(sessionId, title, { showFinished = true } = {}) {
    const actions = showFinished
        ? [{
            id: NOTICE_ACTION_SHOW_FINISHED, key: "activities_notice_show_finished", sessionId,
        }]
        : [];
    return titledNotice("activities_notice_restored", title, { actions });
}

/** Whether the server refused the change because the activity is not finished. */
export function isNotFinishedRefusal(error) {
    return error?.status === 409 && error?.data?.code === ACTIVITY_NOT_FINISHED;
}

/**
 * Why an archive or a restore failed: the activity is not finished (409
 * `ACTIVITY_NOT_FINISHED`, the list was stale and is loaded again), or a
 * generic failure.
 */
export function archiveChangeFailureNotice(error, archived) {
    if (archived && isNotFinishedRefusal(error)) {
        return failureNotice("activities_notice_archive_not_finished");
    }
    return failureNotice(archived
        ? "activities_notice_archive_failed"
        : "activities_notice_restore_failed");
}

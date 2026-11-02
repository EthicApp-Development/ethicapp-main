// Feedback for the Designs page's row actions (#978, epic #966): the choices
// of the delete confirmation and the notices that follow a duplicate, an
// archive, a restore or a delete, or say why one failed.
//
// A notice is plain data: a message key with its parameters, a tone, and the
// links it offers ("Edit copy", "Undo"). The page shows one notice at a time,
// for a few seconds, and the teacher can dismiss it.

/** The delete dialog's answers. */
export const DELETE_CHOICE_DELETE = "delete";
export const DELETE_CHOICE_ARCHIVE = "archive";
export const DELETE_CHOICE_CANCEL = "cancel";

/** Links a notice offers. */
export const NOTICE_ACTION_EDIT_COPY = "edit-copy";
export const NOTICE_ACTION_UNDO_ARCHIVE = "undo-archive";

export const NOTICE_TONE_SUCCESS = "success";
export const NOTICE_TONE_DANGER = "danger";

/** How long a notice stays, in milliseconds. */
export const NOTICE_TIMEOUT_MS = 8 * 1000;

/** The dialog's answer, read from what it resolved with. Anything else cancels. */
export function deleteChoiceOf(value) {
    return value === DELETE_CHOICE_DELETE || value === DELETE_CHOICE_ARCHIVE
        ? value
        : DELETE_CHOICE_CANCEL;
}

/** A design's title, or "" when the design or its title is missing. */
export function designTitle(design) {
    const title = design?.metainfo?.title;
    return typeof title === "string" ? title.trim() : "";
}

/** The title of the design with this id among `designs`, or "". */
export function findDesignTitle(designs, id) {
    const design = Array.isArray(designs) ? designs.find(item => item?.id === id) : null;
    return designTitle(design);
}

// A notice that names its design, or says the same without a name when the
// title is unknown.
function titledNotice(baseKey, title, { tone = NOTICE_TONE_SUCCESS, actions = [] } = {}) {
    return {
        messageKey: title ? baseKey : `${baseKey}_untitled`,
        params:     title ? { title } : {},
        tone,
        actions,
    };
}

function failureNotice(messageKey) {
    return { messageKey, params: {}, tone: NOTICE_TONE_DANGER, actions: [] };
}

/** "Created "<copy>"", with "Edit copy". */
export function duplicateNotice(copyId, copyTitle) {
    const actions = copyId === null || copyId === undefined
        ? []
        : [{ id: NOTICE_ACTION_EDIT_COPY, key: "designs_notice_edit_copy", designId: copyId }];
    return titledNotice("designs_notice_duplicated", copyTitle, { actions });
}

/** "Archived "<title>"", with "Undo". */
export function archiveNotice(designId, title) {
    return titledNotice("designs_notice_archived", title, {
        actions: [{ id: NOTICE_ACTION_UNDO_ARCHIVE, key: "designs_notice_undo", designId }],
    });
}

/** "Restored "<title>"". */
export function restoreNotice(title) {
    return titledNotice("designs_notice_restored", title);
}

/** "Deleted "<title>"". */
export function deleteNotice(title) {
    return titledNotice("designs_notice_deleted", title);
}

/**
 * Why a delete failed: the server's coded refusal for a design an activity
 * uses (`DESIGN_IN_USE`, #963), or a generic failure.
 */
export function deleteFailureNotice(error) {
    return failureNotice(error?.data?.code === "DESIGN_IN_USE"
        ? "design_delete_in_use"
        : "design_delete_failed");
}

export function duplicateFailureNotice() {
    return failureNotice("designs_duplicate_failed");
}

export function archiveFailureNotice() {
    return failureNotice("design_archive_error");
}

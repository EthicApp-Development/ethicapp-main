// Feedback for the Designs page's row actions (#978): the delete dialog's
// answers and the notices after duplicating, archiving, restoring and deleting.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DELETE_CHOICE_ARCHIVE,
    DELETE_CHOICE_CANCEL,
    DELETE_CHOICE_DELETE,
    NOTICE_ACTION_EDIT_COPY,
    NOTICE_ACTION_UNDO_ARCHIVE,
    archiveFailureNotice,
    archiveNotice,
    deleteChoiceOf,
    deleteFailureNotice,
    deleteNotice,
    duplicateFailureNotice,
    duplicateNotice,
    findDesignTitle,
    restoreNotice,
} from "../design-action-feedback.js";

describe("deleteChoiceOf", () => {
    it("keeps delete and archive", () => {
        assert.equal(deleteChoiceOf("delete"), DELETE_CHOICE_DELETE);
        assert.equal(deleteChoiceOf("archive"), DELETE_CHOICE_ARCHIVE);
    });

    it("reads anything else as cancel", () => {
        for (const value of [undefined, null, "", "backdrop click", true, "DELETE"]) {
            assert.equal(deleteChoiceOf(value), DELETE_CHOICE_CANCEL);
        }
    });
});

describe("findDesignTitle", () => {
    const designs = [
        { id: 1, metainfo: { title: "  Remote work ethics " } },
        { id: 2, metainfo: {} },
        { id: 3 },
    ];

    it("finds the trimmed title by id", () => {
        assert.equal(findDesignTitle(designs, 1), "Remote work ethics");
    });

    it("answers an empty title when the design or its title is missing", () => {
        assert.equal(findDesignTitle(designs, 2), "");
        assert.equal(findDesignTitle(designs, 3), "");
        assert.equal(findDesignTitle(designs, 9), "");
        assert.equal(findDesignTitle(null, 1), "");
    });
});

describe("notices", () => {
    it("names the copy and links to its editor", () => {
        assert.deepEqual(duplicateNotice(99, "Copy of X"), {
            messageKey: "designs_notice_duplicated",
            params:     { title: "Copy of X" },
            tone:       "success",
            actions:    [
                { id: NOTICE_ACTION_EDIT_COPY, key: "designs_notice_edit_copy", designId: 99 },
            ],
        });
    });

    it("offers no link without the copy's id, and no name without its title", () => {
        const notice = duplicateNotice(undefined, "");
        assert.equal(notice.messageKey, "designs_notice_duplicated_untitled");
        assert.deepEqual(notice.params, {});
        assert.deepEqual(notice.actions, []);
    });

    it("offers to undo an archive", () => {
        assert.deepEqual(archiveNotice(4, "Gone"), {
            messageKey: "designs_notice_archived",
            params:     { title: "Gone" },
            tone:       "success",
            actions:    [
                { id: NOTICE_ACTION_UNDO_ARCHIVE, key: "designs_notice_undo", designId: 4 },
            ],
        });
    });

    it("names restored and deleted designs, without links", () => {
        assert.equal(restoreNotice("A").messageKey, "designs_notice_restored");
        assert.deepEqual(restoreNotice("A").actions, []);
        assert.equal(deleteNotice("").messageKey, "designs_notice_deleted_untitled");
        assert.deepEqual(deleteNotice("B").params, { title: "B" });
    });

    it("says why a delete failed: in use, or a generic failure", () => {
        assert.equal(deleteFailureNotice({ data: { code: "DESIGN_IN_USE" } }).messageKey,
            "design_delete_in_use");
        assert.equal(deleteFailureNotice({ status: 500 }).messageKey, "design_delete_failed");
        assert.equal(deleteFailureNotice(undefined).messageKey, "design_delete_failed");
        assert.equal(deleteFailureNotice(undefined).tone, "danger");
    });

    it("says when a duplicate or an archive failed", () => {
        assert.equal(duplicateFailureNotice().messageKey, "designs_duplicate_failed");
        assert.equal(archiveFailureNotice().messageKey, "design_archive_error");
        assert.equal(archiveFailureNotice().tone, "danger");
    });
});

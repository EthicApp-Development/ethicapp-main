// The Cases page's action feedback (#1017): the delete dialog's content and
// the notices that follow each action.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    archiveFailureNotice,
    archiveNotice,
    caseTitle,
    deleteChoiceOf,
    deleteFailureNotice,
    deleteNotice,
    deleteRefusalOf,
    designsLosingCase,
    duplicateFailureNotice,
    duplicateNotice,
    findCaseTitle,
    importFailureNotice,
    importNotice,
    isCodedDeleteRefusal,
    restoreFailureNotice,
    restoreNotice,
} from "../case-action-feedback.js";

const locale = name => JSON.parse(readFileSync(new URL(
    `../../../locales/${name}.json`, import.meta.url), "utf8"));
const LOCALES = [locale("es_CL"), locale("en_US")];

describe("case titles", () => {
    it("reads a case's title, trimmed, or nothing", () => {
        assert.equal(caseTitle({ title: "  Screens  " }), "Screens");
        assert.equal(caseTitle({ title: null }), "");
        assert.equal(caseTitle(null), "");
    });

    it("finds a case's title by id", () => {
        const cases = [{ id: 1, title: "One" }, { id: 2, title: "Two" }];
        assert.equal(findCaseTitle(cases, 2), "Two");
        assert.equal(findCaseTitle(cases, 3), "");
        assert.equal(findCaseTitle(null, 1), "");
    });
});

describe("delete dialog content", () => {
    it("lists the teacher's designs that lose the case, untitled ones without a title", () => {
        assert.deepEqual(designsLosingCase({
            ownDesigns: [
                { id: 3, title: " Remote work ", archived: false },
                { id: 4, title: null, archived: true },
                { id: 5, title: "   " },
                { title: "No id" },
            ],
        }), [
            { id: 3, title: "Remote work", archived: false },
            { id: 4, title: null, archived: true },
            { id: 5, title: null, archived: false },
        ]);
        assert.deepEqual(designsLosingCase(null), []);
    });

    it("lets a case nobody else keeps be deleted", () => {
        assert.equal(deleteRefusalOf({
            ownDesigns:           [{ id: 3 }],
            activityCount:        0,
            otherDesignCount:     0,
            otherTeacherCount:    0,
            designsKeepingAccess: 0,
        }), null);
        assert.equal(deleteRefusalOf(null), null);
    });

    it("refuses a case an activity uses, first", () => {
        assert.deepEqual(deleteRefusalOf({ activityCount: 2, designsKeepingAccess: 3 }),
            { key: "cases_delete_in_use_other", params: { count: 2 } });
        assert.deepEqual(deleteRefusalOf({ activityCount: 1 }),
            { key: "cases_delete_in_use_one", params: { count: 1 } });
    });

    it("refuses a case other teachers' designs keep, counting those designs", () => {
        assert.deepEqual(deleteRefusalOf({
            activityCount:        0,
            otherDesignCount:     4,
            otherTeacherCount:    2,
            designsKeepingAccess: 3,
        }), { key: "cases_delete_used_by_others_other", params: { count: 3, teachers: 2 } });
        assert.deepEqual(deleteRefusalOf({ designsKeepingAccess: 1, otherTeacherCount: 1 }),
            { key: "cases_delete_used_by_others_one", params: { count: 1, teachers: 1 } });
    });

    it("does not refuse for designs without a creator, which the server ignores", () => {
        assert.equal(deleteRefusalOf({ otherDesignCount: 2, designsKeepingAccess: 0 }), null);
    });

    it("reads the dialog's answers, anything else cancelling", () => {
        assert.equal(deleteChoiceOf("delete"), "delete");
        assert.equal(deleteChoiceOf("archive"), "archive");
        assert.equal(deleteChoiceOf("backdrop click"), "cancel");
    });
});

describe("case notices", () => {
    it("names the copy after a duplicate, with Edit copy", () => {
        assert.deepEqual(duplicateNotice(9, "Screens (copy)"), {
            messageKey: "cases_notice_duplicated",
            params:     { title: "Screens (copy)" },
            tone:       "success",
            actions:    [{ id: "edit-copy", key: "cases_notice_edit_copy", caseId: 9 }],
        });
        assert.equal(duplicateNotice(9, "").messageKey, "cases_notice_duplicated_untitled");
        assert.deepEqual(duplicateNotice(null, "Copy").actions, []);
    });

    it("names the copy after an import, with Edit copy and View in My cases", () => {
        assert.deepEqual(importNotice(9, "The dam"), {
            messageKey: "cases_notice_imported",
            params:     { title: "The dam" },
            tone:       "success",
            actions:    [
                { id: "edit-copy", key: "cases_notice_edit_copy", caseId: 9 },
                { id: "show-in-mine", key: "cases_notice_show_in_mine", caseId: 9 },
            ],
        });
        assert.equal(importNotice(9, "").messageKey, "cases_notice_imported_untitled");
        assert.deepEqual(importNotice(undefined, "The dam").actions, []);
    });

    it("names an archived case, with Undo", () => {
        assert.deepEqual(archiveNotice(4, "Screens"), {
            messageKey: "cases_notice_archived",
            params:     { title: "Screens" },
            tone:       "success",
            actions:    [{ id: "undo-archive", key: "cases_notice_undo", caseId: 4 }],
        });
        assert.equal(archiveNotice(4, "").messageKey, "cases_notice_archived_untitled");
    });

    it("names a restored or deleted case, without links", () => {
        assert.deepEqual(restoreNotice("Screens"), {
            messageKey: "cases_notice_restored", params:     { title: "Screens" },
            tone:       "success", actions:    [],
        });
        assert.deepEqual(deleteNotice("Screens"), {
            messageKey: "cases_notice_deleted", params:     { title: "Screens" },
            tone:       "success", actions:    [],
        });
        assert.equal(deleteNotice("").messageKey, "cases_notice_deleted_untitled");
    });

    it("says why a delete failed, in red", () => {
        const failure = code => deleteFailureNotice({ data: { code } });
        assert.deepEqual(failure("CASE_USED_BY_OTHER_TEACHERS"), {
            messageKey: "cases_notice_delete_used_by_other_teachers",
            params:     {},
            tone:       "danger",
            actions:    [],
        });
        assert.equal(failure("CASE_USED_BY_LAUNCHED_ACTIVITY").messageKey,
            "cases_notice_delete_used_by_activity");
        assert.equal(failure("CASE_NOT_FOUND").messageKey, "cases_notice_delete_not_found");
        assert.equal(failure("toString").messageKey, "cases_notice_delete_failed");
        assert.equal(deleteFailureNotice(new Error("down")).messageKey,
            "cases_notice_delete_failed");
    });

    it("tells the coded refusals, after which the lists were stale", () => {
        assert.equal(isCodedDeleteRefusal({ data: { code: "CASE_NOT_FOUND" } }), true);
        assert.equal(isCodedDeleteRefusal({ data: { code: "CASE_USED_BY_OTHER_TEACHERS" } }), true);
        assert.equal(isCodedDeleteRefusal({ status: 500 }), false);
    });

    it("says when a duplicate, an archive or a restore failed", () => {
        assert.equal(duplicateFailureNotice().messageKey, "cases_notice_duplicate_failed");
        assert.equal(archiveFailureNotice().messageKey, "cases_notice_archive_failed");
        assert.equal(restoreFailureNotice().messageKey, "cases_notice_restore_failed");
        assert.equal(restoreFailureNotice().tone, "danger");
    });

    it("says why an import failed: the case is no longer shared, or another failure", () => {
        assert.deepEqual(importFailureNotice({ data: { code: "CASE_NOT_IMPORTABLE" } }), {
            messageKey: "cases_notice_import_not_importable",
            params:     {},
            tone:       "danger",
            actions:    [],
        });
        assert.equal(importFailureNotice(new Error("down")).messageKey,
            "cases_notice_import_failed");
        assert.equal(importFailureNotice({ data: { code: "OTHER" } }).tone, "danger");
    });

    it("has every key it uses in both locales", () => {
        const notices = [
            duplicateNotice(1, "t"), duplicateNotice(1, ""), importNotice(1, "t"),
            importNotice(1, ""), archiveNotice(1, "t"), archiveNotice(1, ""),
            restoreNotice("t"), restoreNotice(""), deleteNotice("t"), deleteNotice(""),
            duplicateFailureNotice(), archiveFailureNotice(), restoreFailureNotice(),
            importFailureNotice({ data: { code: "CASE_NOT_IMPORTABLE" } }), importFailureNotice(),
            ...["CASE_NOT_FOUND", "CASE_USED_BY_LAUNCHED_ACTIVITY", "CASE_USED_BY_OTHER_TEACHERS",
                "OTHER"].map(code => deleteFailureNotice({ data: { code } })),
        ];
        const keys = new Set(notices.flatMap(notice =>
            [notice.messageKey, ...notice.actions.map(action => action.key)]));
        for (const catalog of LOCALES) {
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", key);
            }
        }
    });
});

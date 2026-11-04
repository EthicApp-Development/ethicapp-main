// The Activities page's action feedback (#1052): the notices after "Copiar
// código", an archive and a restore, and why one failed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    NOTICE_ACTION_SHOW_ARCHIVED,
    NOTICE_ACTION_SHOW_FINISHED,
    NOTICE_ACTION_UNDO_ARCHIVE,
    NOTICE_TIMEOUT_MS,
    archiveChangeFailureNotice,
    archiveNotice,
    codeCopiedNotice,
    copyFailureNotice,
    isNotFinishedRefusal,
    restoreNotice,
} from "../activity-action-feedback.js";
import { NOTICE_TIMEOUT_MS as DESIGNS_NOTICE_TIMEOUT_MS } from "../design-action-feedback.js";

const LOCALES = new URL("../../../locales/", import.meta.url);
const catalog = name => JSON.parse(readFileSync(new URL(`${name}.json`, LOCALES), "utf8"));

const NOT_FINISHED = { status: 409, data: { code: "ACTIVITY_NOT_FINISHED" } };

function noticeKeys(notice) {
    return [notice.messageKey, ...notice.actions.map(action => action.key)];
}

describe("activity notices", () => {
    it("stays as long as the Designs and Cases pages' notices", () => {
        assert.equal(NOTICE_TIMEOUT_MS, DESIGNS_NOTICE_TIMEOUT_MS);
    });

    it("says the code was copied, or that it could not be", () => {
        assert.deepEqual(codeCopiedNotice(), {
            messageKey: "activities_notice_code_copied",
            params:     {},
            tone:       "success",
            actions:    [],
        });
        assert.equal(copyFailureNotice().messageKey, "activities_notice_copy_failed");
        assert.equal(copyFailureNotice().tone, "danger");
    });

    it("names an archived activity, with Deshacer and Ver Archivadas", () => {
        assert.deepEqual(archiveNotice(4, "Ética · Sección 4"), {
            messageKey: "activities_notice_archived",
            params:     { title: "Ética · Sección 4" },
            tone:       "success",
            actions:    [
                {
                    id:        NOTICE_ACTION_UNDO_ARCHIVE,
                    key:       "activities_notice_undo",
                    sessionId: 4,
                    title:     "Ética · Sección 4",
                },
                {
                    id:        NOTICE_ACTION_SHOW_ARCHIVED,
                    key:       "activities_notice_show_archived",
                    sessionId: 4,
                },
            ],
        });
    });

    it("leaves out Ver Archivadas on Archivadas, and the name when there is none", () => {
        const notice = archiveNotice(4, "", { showArchived: false });
        assert.equal(notice.messageKey, "activities_notice_archived_untitled");
        assert.deepEqual(notice.params, {});
        assert.deepEqual(notice.actions.map(action => action.id), [NOTICE_ACTION_UNDO_ARCHIVE]);
    });

    it("names a restored activity, with Ver en Terminadas unless already there", () => {
        assert.deepEqual(restoreNotice(5, "A"), {
            messageKey: "activities_notice_restored",
            params:     { title: "A" },
            tone:       "success",
            actions:    [{
                id:        NOTICE_ACTION_SHOW_FINISHED,
                key:       "activities_notice_show_finished",
                sessionId: 5,
            }],
        });
        assert.deepEqual(restoreNotice(5, "A", { showFinished: false }).actions, []);
        assert.equal(restoreNotice(5, "").messageKey, "activities_notice_restored_untitled");
    });

    it("says why an archive was refused: the activity is not finished", () => {
        assert.equal(isNotFinishedRefusal(NOT_FINISHED), true);
        assert.equal(isNotFinishedRefusal({ status: 409 }), false);
        assert.equal(isNotFinishedRefusal({ status: 500, data: NOT_FINISHED.data }), false);
        assert.equal(isNotFinishedRefusal(undefined), false);
        const notice = archiveChangeFailureNotice(NOT_FINISHED, true);
        assert.equal(notice.messageKey, "activities_notice_archive_not_finished");
        assert.equal(notice.tone, "danger");
        assert.deepEqual(notice.actions, []);
    });

    it("says an archive or a restore failed otherwise", () => {
        assert.equal(archiveChangeFailureNotice({ status: 500 }, true).messageKey,
            "activities_notice_archive_failed");
        assert.equal(archiveChangeFailureNotice(new Error("offline"), false).messageKey,
            "activities_notice_restore_failed");
        assert.equal(archiveChangeFailureNotice(NOT_FINISHED, false).messageKey,
            "activities_notice_restore_failed");
    });

    it("has every key in both locales, and says nothing about participants", () => {
        const notices = [
            codeCopiedNotice(), copyFailureNotice(),
            archiveNotice(1, "T"), archiveNotice(1, ""),
            restoreNotice(1, "T"), restoreNotice(1, ""),
            archiveChangeFailureNotice(NOT_FINISHED, true),
            archiveChangeFailureNotice({}, true), archiveChangeFailureNotice({}, false),
        ];
        const keys = new Set([...notices.flatMap(noticeKeys), "activities_notice_dismiss"]);
        for (const locale of ["es_CL", "en_US"]) {
            const texts = catalog(locale);
            for (const key of keys) {
                assert.equal(typeof texts[key], "string", `${locale}: ${key}`);
                assert.doesNotMatch(texts[key], /participant|estudiant|student/iu,
                    `${locale}: ${key}`);
            }
        }
    });
});

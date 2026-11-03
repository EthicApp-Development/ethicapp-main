// The Cases page's tables (#1013, epic #1008): each row's status, its
// designs, its one visible action and its "⋯" menu, chosen by the case's
// state.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CASES_TAB_ARCHIVED,
    CASES_TAB_MINE,
    CASES_TAB_SHARED,
    buildCaseRow,
    buildCaseTables,
    caseMetaParts,
    deleteBlockReason,
    designsSummary,
    languageNamesByCode,
    orderCasesNewestFirst,
    primaryRowAction,
    rowMenuEntries,
    sharingState,
    statusLabel,
    tabFromSearch,
    tabSearchValue,
} from "../cases-table.js";

const READY = { status: "ready", activityCount: 0 };
const PROCESSING = { status: "processing", activityCount: 0 };
const PDF_ERROR = { status: "pdf-error", activityCount: 0 };
const IN_USE = { status: "in-use", activityCount: 3 };
const ALL_STATUSES = [READY, PROCESSING, PDF_ERROR, IN_USE];

const NO_USE = { activityCount: 0, ownDesignCount: 0, otherDesignCount: 0, otherTeacherCount: 0 };

const ids = entries => entries.map(entry => entry.id);
const deleteOf = menu => menu.find(entry => entry.id === "delete");

function caseOf(fields = {}) {
    return {
        id:           1,
        title:        "Case",
        visibility:   "private",
        languageCode: "es_CL",
        usage:        { ...NO_USE },
        videos:       [],
        documents:    [],
        ...fields,
    };
}

describe("cases table, tabs", () => {
    it("reads the tab from the URL, defaulting to My cases", () => {
        assert.equal(tabFromSearch({}), CASES_TAB_MINE);
        assert.equal(tabFromSearch({ tab: "shared" }), CASES_TAB_SHARED);
        assert.equal(tabFromSearch({ tab: "archived" }), CASES_TAB_ARCHIVED);
        assert.equal(tabFromSearch({ tab: "nope" }), CASES_TAB_MINE);
        assert.equal(tabFromSearch(undefined), CASES_TAB_MINE);
    });

    it("leaves My cases out of the URL", () => {
        assert.equal(tabSearchValue(CASES_TAB_MINE), null);
        assert.equal(tabSearchValue(CASES_TAB_SHARED), "shared");
        assert.equal(tabSearchValue(CASES_TAB_ARCHIVED), "archived");
        assert.equal(tabSearchValue("nope"), null);
    });
});

describe("cases table, the status", () => {
    it("says Ready, Processing PDF, PDF error or In use with its activities", () => {
        assert.deepEqual(statusLabel(READY), { key: "cases_status_ready", params: {}, tone: "ready" });
        assert.deepEqual(statusLabel(PROCESSING),
            { key: "cases_status_processing", params: {}, tone: "processing" });
        assert.deepEqual(statusLabel(PDF_ERROR),
            { key: "cases_status_pdf_error", params: {}, tone: "pdf-error" });
        assert.deepEqual(statusLabel(IN_USE),
            { key: "cases_status_in_use_other", params: { count: 3 }, tone: "in-use" });
        assert.equal(statusLabel({ status: "in-use", activityCount: 1 }).key, "cases_status_in_use_one");
    });
});

describe("cases table, the visible action", () => {
    it("is Edit for a ready or processing case", () => {
        assert.equal(primaryRowAction(READY).id, "edit");
        assert.equal(primaryRowAction(PROCESSING).id, "edit");
        assert.equal(primaryRowAction(READY).key, "cases_action_edit");
    });

    it("is Replace PDF for a case whose PDF failed", () => {
        assert.equal(primaryRowAction(PDF_ERROR).id, "replace-pdf");
        assert.equal(primaryRowAction(PDF_ERROR).key, "cases_action_replace_pdf");
    });

    it("is Duplicate to edit for a case in use", () => {
        assert.equal(primaryRowAction(IN_USE).id, "duplicate-to-edit");
        assert.equal(primaryRowAction(IN_USE).key, "cases_action_duplicate_to_edit");
    });

    it("is Restore for any archived case", () => {
        for (const status of ALL_STATUSES) {
            const primary = primaryRowAction(status, { archived: true });
            assert.equal(primary.id, "restore");
            assert.equal(primary.key, "cases_action_restore");
        }
    });
});

describe("cases table, the row menu", () => {
    it("holds View, Duplicate, Archive and then Delete in My cases, whatever the status", () => {
        for (const status of ALL_STATUSES) {
            assert.deepEqual(ids(rowMenuEntries(status, NO_USE)),
                ["view", "duplicate", "archive", "delete"]);
        }
    });

    it("holds View, Duplicate and Delete in Archived, whatever the status", () => {
        for (const status of ALL_STATUSES) {
            assert.deepEqual(ids(rowMenuEntries(status, NO_USE, { archived: true })),
                ["view", "duplicate", "delete"]);
        }
    });

    it("marks Delete as dangerous and last, and only it", () => {
        const menu = rowMenuEntries(READY, NO_USE);
        assert.equal(menu.at(-1).id, "delete");
        assert.equal(menu.at(-1).danger, true);
        assert.equal(menu.slice(0, -1).some(entry => entry.danger || entry.disabled), false);
    });

    it("enables Delete for a ready, processing or failed case nobody else uses", () => {
        for (const status of [READY, PROCESSING, PDF_ERROR]) {
            const entry = deleteOf(rowMenuEntries(status, NO_USE));
            assert.equal(entry.disabled, false);
            assert.equal(entry.reason, null);
        }
    });

    it("disables Delete for a case in use, with its activities, in both tabs", () => {
        for (const archived of [false, true]) {
            const entry = deleteOf(rowMenuEntries(IN_USE, NO_USE, { archived }));
            assert.equal(entry.disabled, true);
            assert.deepEqual(entry.reason, { key: "cases_delete_in_use_other", params: { count: 3 } });
        }
        assert.deepEqual(deleteOf(rowMenuEntries({ status: "in-use", activityCount: 1 }, NO_USE)).reason,
            { key: "cases_delete_in_use_one", params: { count: 1 } });
    });

    it("disables Delete for a case other teachers' designs use, in both tabs", () => {
        const usage = { ...NO_USE, otherDesignCount: 3, otherTeacherCount: 2 };
        for (const archived of [false, true]) {
            for (const status of [READY, PROCESSING, PDF_ERROR]) {
                const entry = deleteOf(rowMenuEntries(status, usage, { archived }));
                assert.equal(entry.disabled, true);
                assert.deepEqual(entry.reason, {
                    key:    "cases_delete_used_by_others_other",
                    params: { count: 3, teachers: 2 },
                });
            }
        }
    });

    it("enables Delete when only the teacher's own designs use the case", () => {
        const usage = { ...NO_USE, ownDesignCount: 4 };
        assert.equal(deleteOf(rowMenuEntries(READY, usage)).disabled, false);
    });
});

describe("cases table, why Delete is disabled", () => {
    it("says the activities first when the case is also used by other teachers", () => {
        const usage = { ...NO_USE, otherDesignCount: 2, otherTeacherCount: 1 };
        assert.equal(deleteBlockReason(IN_USE, usage).key, "cases_delete_in_use_other");
    });

    it("counts other teachers' designs and their teachers", () => {
        const reason = usage => deleteBlockReason(READY, { ...NO_USE, ...usage })?.key;
        assert.equal(reason({ otherDesignCount: 1, otherTeacherCount: 1 }), "cases_delete_used_by_others_one");
        assert.equal(reason({ otherDesignCount: 3, otherTeacherCount: 1 }),
            "cases_delete_used_by_others_one_teacher");
        assert.equal(reason({ otherDesignCount: 3, otherTeacherCount: 2 }), "cases_delete_used_by_others_other");
        // A design without a creator adds no teacher.
        assert.equal(reason({ otherDesignCount: 2, otherTeacherCount: 0 }), "cases_delete_used_by_others");
        assert.equal(reason({}), undefined);
    });
});

describe("cases table, the designs column", () => {
    it("says No designs when none uses the case", () => {
        assert.deepEqual(designsSummary(NO_USE),
            { none: true, total: { key: "cases_designs_none", params: {} }, others: null });
        assert.equal(designsSummary(undefined).none, true);
    });

    it("counts every design, with other teachers' under it", () => {
        assert.deepEqual(designsSummary({ ownDesignCount: 1, otherDesignCount: 3 }), {
            none:   false,
            total:  { key: "cases_designs_other", params: { count: 4 } },
            others: { key: "cases_designs_others_other", params: { count: 3 } },
        });
        assert.deepEqual(designsSummary({ ownDesignCount: 1, otherDesignCount: 0 }), {
            none:   false,
            total:  { key: "cases_designs_one", params: { count: 1 } },
            others: null,
        });
        assert.equal(designsSummary({ otherDesignCount: 1 }).others.key, "cases_designs_others_one");
    });
});

describe("cases table, the details under the title", () => {
    const names = languageNamesByCode([
        { code: "es_CL", native_name: "Español" },
        { code: "en_US", native_name: "English" },
    ]);

    it("lists the rendered pages, the videos, the documents and the language's name", () => {
        const caseItem = caseOf({
            documentProcessing: { status: "completed", pageCount: 6 },
            videos:             [{}],
            documents:          [{}, {}],
        });
        assert.deepEqual(caseMetaParts(caseItem, names), [
            { key: "cases_meta_pages_other", params: { count: 6 } },
            { key: "cases_meta_videos_one", params: { count: 1 } },
            { key: "cases_meta_documents_other", params: { count: 2 } },
            { text: "Español" },
        ]);
    });

    it("leaves out the pages until the PDF is rendered, and what the case does not have", () => {
        const caseItem = caseOf({ documentProcessing: { status: "processing", pageCount: 6 } });
        assert.deepEqual(caseMetaParts(caseItem, names), [{ text: "Español" }]);
    });

    it("shows the language's code when its name is unknown", () => {
        assert.deepEqual(caseMetaParts(caseOf({ languageCode: "fr_FR" }), names), [{ text: "fr_FR" }]);
    });
});

describe("cases table, sharing", () => {
    it("can be changed for any case of My cases, a case in use included", () => {
        assert.deepEqual(sharingState(), { disabled: false, reasonKey: null });
        const row = buildCaseRow(caseOf({ usage: { ...NO_USE, activityCount: 2 } }));
        assert.equal(row.statusInfo.status, "in-use");
        assert.equal(row.sharing.disabled, false);
    });

    it("cannot be changed for an archived case", () => {
        assert.deepEqual(sharingState({ archived: true }),
            { disabled: true, reasonKey: "cases_sharing_disabled_archived" });
    });
});

describe("cases table, rows", () => {
    it("builds each status's row in My cases", () => {
        const rows = {
            ready:      buildCaseRow(caseOf()),
            processing: buildCaseRow(caseOf({ documentProcessing: { status: "pending" } })),
            pdfError:   buildCaseRow(caseOf({ documentProcessing: { status: "failed" } })),
            inUse:      buildCaseRow(caseOf({
                documentProcessing: { status: "failed" },
                usage:              { ...NO_USE, activityCount: 1, ownDesignCount: 1 },
            })),
        };
        assert.deepEqual(Object.values(rows).map(row => [row.status.tone, row.primary.id]), [
            ["ready", "edit"],
            ["processing", "edit"],
            ["pdf-error", "replace-pdf"],
            ["in-use", "duplicate-to-edit"],
        ]);
        assert.equal(deleteOf(rows.inUse.menu).disabled, true);
    });

    it("builds an archived row with Restore, keeping its status", () => {
        const row = buildCaseRow(caseOf({ archived: true, documentProcessing: { status: "failed" } }));
        assert.equal(row.status.tone, "pdf-error");
        assert.equal(row.primary.id, "restore");
        assert.deepEqual(ids(row.menu), ["view", "duplicate", "delete"]);
        assert.equal(row.sharing.disabled, true);
    });

    it("orders the cases newest first, then by id", () => {
        const ordered = orderCasesNewestFirst([
            { id: 1, createdAt: "2026-01-01T00:00:00Z" },
            { id: 3, createdAt: "2026-03-01T00:00:00Z" },
            { id: 2, createdAt: "2026-03-01T00:00:00Z" },
            { id: 4 },
        ]);
        assert.deepEqual(ids(ordered), [3, 2, 1, 4]);
    });

    it("builds each tab's list from GET /cases by scope", () => {
        const tables = buildCaseTables({
            own:      [caseOf({ id: 1 }), caseOf({ id: 2 })],
            archived: [caseOf({ id: 3, archived: true })],
            shared:   [caseOf({ id: 4, visibility: "public" })],
        });
        assert.deepEqual(ids(tables.mine), [2, 1]);
        assert.deepEqual(ids(tables.archived), [3]);
        assert.equal(tables.archived[0].primary.id, "restore");
        assert.deepEqual(ids(tables.shared), [4]);
        assert.deepEqual(buildCaseTables(), { mine: [], archived: [], shared: [] });
    });
});

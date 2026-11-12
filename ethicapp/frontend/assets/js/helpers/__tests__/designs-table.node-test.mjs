// The Designs page's tables (#975, epic #966): each row's status, its one
// visible action and its "⋯" menu, chosen by the design's state.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DESIGNS_TAB_ARCHIVED,
    DESIGNS_TAB_MINE,
    DESIGNS_TAB_SHARED,
    buildDesignRow,
    buildDesignTables,
    primaryRowAction,
    rowMenuEntries,
    sharingState,
    statusLabel,
    tabFromSearch,
    tabSearchValue,
} from "../designs-table.js";

const READY = { status: "ready", errorCount: 0, activityCount: 0 };
const ERRORS = { status: "errors", errorCount: 2, activityCount: 0 };
const IN_USE = { status: "in-use", errorCount: 0, activityCount: 5 };

const ids = entries => entries.map(entry => entry.id);

describe("designs table, the visible action", () => {
    it("is Edit for a ready design, Fix for one with errors and Duplicate to edit for one in use", () => {
        assert.equal(primaryRowAction(READY).id, "edit");
        assert.equal(primaryRowAction(ERRORS).id, "fix");
        assert.equal(primaryRowAction(IN_USE).id, "duplicate-to-edit");
        assert.equal(primaryRowAction(READY).key, "designs_action_edit");
        assert.equal(primaryRowAction(ERRORS).key, "designs_action_fix");
        assert.equal(primaryRowAction(IN_USE).key, "designs_action_duplicate_to_edit");
    });

    it("is Restore for any archived design", () => {
        for (const status of [READY, ERRORS, IN_USE]) {
            assert.equal(primaryRowAction(status, { archived: true }).id, "restore");
        }
    });
});

describe("designs table, the row menu", () => {
    it("holds View, Duplicate, Archive and then Delete, without a launch entry", () => {
        for (const status of [READY, ERRORS, IN_USE]) {
            const menu = rowMenuEntries(status);
            assert.deepEqual(ids(menu), ["view", "duplicate", "archive", "delete"]);
            assert.equal(menu.some(entry => /launch/u.test(entry.id + entry.key)), false);
        }
    });

    it("holds View, Duplicate and Delete in the Archived tab", () => {
        assert.deepEqual(ids(rowMenuEntries(READY, { archived: true })), ["view", "duplicate", "delete"]);
    });

    it("marks Delete as dangerous and last", () => {
        const menu = rowMenuEntries(READY);
        const last = menu[menu.length - 1];
        assert.equal(last.id, "delete");
        assert.equal(last.danger, true);
        assert.equal(menu.filter(entry => entry.danger).length, 1);
    });

    it("enables Delete for a ready design and one with errors", () => {
        for (const status of [READY, ERRORS]) {
            const remove = rowMenuEntries(status).at(-1);
            assert.equal(remove.disabled, false);
            assert.equal(remove.reason, null);
        }
    });

    it("disables Delete for a design in use and says by how many activities", () => {
        const remove = rowMenuEntries(IN_USE).at(-1);
        assert.equal(remove.disabled, true);
        assert.deepEqual(remove.reason, { key: "designs_delete_in_use_other", params: { count: 5 } });

        const one = rowMenuEntries({ ...IN_USE, activityCount: 1 }).at(-1);
        assert.deepEqual(one.reason, { key: "designs_delete_in_use_one", params: { count: 1 } });
    });

    it("says only 'in use' for a locked design without activities of this teacher", () => {
        const remove = rowMenuEntries({ ...IN_USE, activityCount: 0 }).at(-1);
        assert.equal(remove.disabled, true);
        assert.deepEqual(remove.reason, { key: "designs_delete_in_use", params: {} });
    });

    it("keeps Delete disabled for an archived design in use", () => {
        assert.equal(rowMenuEntries(IN_USE, { archived: true }).at(-1).disabled, true);
    });
});

describe("designs table, the status column", () => {
    it("says ready, the number of errors or the number of activities", () => {
        assert.deepEqual(statusLabel(READY), { key: "designs_status_ready", params: {}, tone: "ready" });
        assert.deepEqual(statusLabel(ERRORS),
            { key: "designs_status_errors_other", params: { count: 2 }, tone: "errors" });
        assert.equal(statusLabel({ ...ERRORS, errorCount: 1 }).key, "designs_status_errors_one");
        assert.deepEqual(statusLabel(IN_USE),
            { key: "designs_status_in_use_other", params: { count: 5 }, tone: "in-use" });
        assert.equal(statusLabel({ ...IN_USE, activityCount: 1 }).key, "designs_status_in_use_one");
    });

    it("omits the number when it is not known", () => {
        assert.equal(statusLabel({ ...ERRORS, errorCount: 0 }).key, "designs_status_errors");
        assert.equal(statusLabel({ ...IN_USE, activityCount: 0 }).key, "designs_status_in_use");
    });
});

describe("designs table, the sharing switch", () => {
    it("is enabled for a valid design and disabled, with its reason, for one with errors or archived", () => {
        assert.deepEqual(sharingState({ valid: true }), { disabled: false, reasonKey: null });
        assert.deepEqual(sharingState({ valid: false }),
            { disabled: true, reasonKey: "designs_sharing_disabled_errors" });
        assert.deepEqual(sharingState({ valid: true }, { archived: true }),
            { disabled: true, reasonKey: "designs_sharing_disabled_archived" });
    });
});

describe("designs table, the lists", () => {
    const own = (id, createdAt, fields = {}) =>
        ({ id, userOwned: true, valid: true, createdAt, metainfo: { title: `D${id}` }, ...fields });
    const theirs = (id, fields = {}) =>
        ({ id, userOwned: false, valid: true, visibility: "public", ...fields });
    const DESIGNS = [
        own(1, "2026-01-01T00:00:00Z", { metainfo: { title: "Old" }, phases: [{}] }),
        own(2, "2026-10-01T00:00:00Z", { valid: false, phases: [], associatedCase: { title: "Bridge" } }),
        own(3, "2026-05-01T00:00:00Z", { locked: true }),
        own(4, "2026-06-01T00:00:00Z", { archived: true }),
        theirs(5, { createdAt: "2026-02-01T00:00:00Z" }),
        theirs(6, { valid: false }),
        theirs(7, { archived: true }),
    ];
    const ACTIVITIES = [{ designId: 1 }, { designId: 1 }];

    it("lists own designs newest first, the archived apart, and the designs others share", () => {
        const tables = buildDesignTables(DESIGNS, ACTIVITIES);
        assert.deepEqual(tables.mine.map(row => row.id), [2, 3, 1]);
        assert.deepEqual(tables.archived.map(row => row.id), [4]);
        assert.deepEqual(tables.shared.map(design => design.id), [5]);
    });

    it("gives each row its status, action, menu and switch", () => {
        const tables = buildDesignTables(DESIGNS, ACTIVITIES);
        const byId = new Map(tables.mine.map(row => [row.id, row]));

        assert.equal(byId.get(1).primary.id, "duplicate-to-edit", "used by two activities");
        assert.deepEqual(byId.get(1).status.params, { count: 2 });
        assert.equal(byId.get(2).primary.id, "fix");
        assert.equal(byId.get(2).sharing.disabled, true);
        assert.equal(byId.get(2).caseTitle, "Bridge");
        assert.equal(byId.get(2).phaseCountKey, "launch_wizard_phases_other");
        assert.equal(byId.get(3).primary.id, "duplicate-to-edit", "locked");
        assert.equal(tables.archived[0].primary.id, "restore");
        assert.deepEqual(ids(tables.archived[0].menu), ["view", "duplicate", "delete"]);
    });

    it("builds a row with the title and the number of phases", () => {
        const row = buildDesignRow(DESIGNS[0], new Map());
        assert.equal(row.title, "Old");
        assert.equal(row.phaseCount, 1);
        assert.equal(row.phaseCountKey, "launch_wizard_phases_one");
        assert.equal(row.primary.id, "edit");
    });

    it("gives the row the planned duration of its phases (#1107)", () => {
        const phases = [{ durationMinutes: 15 }, { durationMinutes: 5 }];
        const timed = buildDesignRow({ ...DESIGNS[0], phases }, new Map());
        assert.deepEqual(timed.plannedDuration,
            { key: "phase_duration_minutes", values: { minutes: 20 } });
        const untimed = buildDesignRow({ ...DESIGNS[0], phases: [{}] }, new Map());
        assert.equal(untimed.plannedDuration, null);
    });

    it("lists nothing for a missing payload", () => {
        assert.deepEqual(buildDesignTables(undefined, undefined), { mine: [], archived: [], shared: [] });
    });
});

describe("designs page, the tab in the URL", () => {
    it("reads the tab, defaulting to My designs", () => {
        assert.equal(tabFromSearch({}), DESIGNS_TAB_MINE);
        assert.equal(tabFromSearch({ tab: "shared" }), DESIGNS_TAB_SHARED);
        assert.equal(tabFromSearch({ tab: "archived" }), DESIGNS_TAB_ARCHIVED);
        assert.equal(tabFromSearch({ tab: "nope" }), DESIGNS_TAB_MINE);
        assert.equal(tabFromSearch(undefined), DESIGNS_TAB_MINE);
    });

    it("writes no parameter for My designs", () => {
        assert.equal(tabSearchValue(DESIGNS_TAB_MINE), null);
        assert.equal(tabSearchValue(DESIGNS_TAB_SHARED), "shared");
        assert.equal(tabSearchValue(DESIGNS_TAB_ARCHIVED), "archived");
        assert.equal(tabSearchValue("nope"), null);
    });
});

// The Designs page (#975, epic #966): the tab lives in the URL, rows run
// their actions through the catalog, and the page offers no launch action.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, mock } from "node:test";

import { DesignsPageController } from "../designs-page.controller.js";

const template = readFileSync(new URL(
    "../../../../static/views/teacher/design.index.html", import.meta.url), "utf8");

const theirs = (id, title) =>
    ({ id, userOwned: false, valid: true, visibility: "public", metainfo: { title } });

function makeDesigns() {
    const own = (id, title, fields) =>
        ({ id, userOwned: true, valid: true, visibility: "private", metainfo: { title }, ...fields });
    return [
        own(1, "Ready", { createdAt: "2026-10-01T00:00:00Z" }),
        own(2, "Broken", { valid: false, createdAt: "2026-09-01T00:00:00Z" }),
        own(3, "Used", { visibility: "public", createdAt: "2026-08-01T00:00:00Z" }),
        own(4, "Gone", { archived: true }),
        theirs(5, "Theirs"),
        { ...theirs(6, "Closed case"), importable: false },
    ];
}

function createPage({ search = {}, catalog = {}, publication = {} } = {}) {
    const scopeHandlers = {};
    const calls = {
        navigated:  [], toasts:     [], pushes:     [], replaces:   [],
        duplicated: [], archived:   [], deleted:    [], toggled:    [],
        imported:   [], reloads:    [],
    };
    let current = { ...search };
    const designs = makeDesigns();

    const $scope = {
        $on(name, handler) {
            (scopeHandlers[name] ||= []).push(handler);
        },
        $applyAsync(fn) {
            fn?.();
        },
        navigateTo(path) {
            calls.navigated.push(path);
        },
    };
    const $location = {
        search(key, value) {
            if (key === undefined) {
                return { ...current };
            }
            const next = { ...current };
            if (value === null) {
                delete next[key];
            } else {
                next[key] = String(value);
            }
            current = next;
            calls.pushes.push({ ...current });
            return {
                replace() {
                    calls.pushes.pop();
                    calls.replaces.push({ ...current });
                },
            };
        },
    };
    const $translate = async key => key;
    const toast = { create: options => calls.toasts.push(options.message) };
    const listeners = [];
    const DesignCatalogService = {
        getDesigns: async (force) => {
            calls.reloads.push(force === true);
            return designs;
        },
        importDesign: async (id) => {
            calls.imported.push(id);
            const copy = { ...theirs(99, "Theirs (copy)"), userOwned: true };
            designs.push({ ...copy, importedFromDesignId: id });
            return 99;
        },
        registerListener: (_name, fn) => listeners.push(fn),
        unregisterListener() {},
        applyPrivateVisibilityToDesigns() {},
        duplicateDesign:  async (id) => {
            calls.duplicated.push(id);
            return 99;
        },
        updateDesignArchived: async (id, archived) => {
            calls.archived.push([id, archived]);
        },
        deleteDesign: async (id) => {
            calls.deleted.push(id);
        },
        ...catalog,
    };
    const DesignPublicationService = {
        togglePublicVisibility: async (design) => {
            calls.toggled.push(design.id);
            return { status: "public" };
        },
        ...publication,
    };
    const ActivityCatalogService = { loadActivities: async () => [{ designId: 3 }] };

    const vm = {};
    DesignsPageController.call(vm, $scope, $location, $translate, toast,
        DesignCatalogService, DesignPublicationService, ActivityCatalogService);

    return {
        vm,
        calls,
        settle: () => new Promise(resolve => setImmediate(resolve)),
        // Angular's route update after a search change (Back, Forward, a tab link).
        visit(nextSearch) {
            current = { ...nextSearch };
            (scopeHandlers.$routeUpdate || []).forEach(handler => handler());
        },
        leave() {
            (scopeHandlers.$routeChangeStart || []).forEach(handler => handler());
        },
    };
}

const rowOf = (vm, id, tab = "mine") => vm.getRows(tab).find(row => row.id === id);

describe("designs page, tabs", () => {
    it("opens My designs by default and counts each tab", async () => {
        const { vm } = createPage();
        await vm.ready;
        assert.equal(vm.tab, "mine");
        assert.deepEqual(vm.getRows("mine").map(row => row.id), [1, 2, 3]);
        assert.equal(vm.count("mine"), 3);
        assert.equal(vm.count("shared"), 2);
        assert.equal(vm.count("archived"), 1);
    });

    it("opens the URL's tab, as after a reload", async () => {
        const { vm } = createPage({ search: { tab: "archived" } });
        await vm.ready;
        assert.equal(vm.tab, "archived");
    });

    it("follows the URL on Back and Forward", async () => {
        const { vm, visit } = createPage();
        await vm.ready;
        visit({ tab: "shared" });
        assert.equal(vm.tab, "shared");
        visit({});
        assert.equal(vm.tab, "mine");
    });

    it("opens Shared by others from Import a shared design, adding a history entry", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        vm.openSharedTab();
        assert.equal(vm.tab, "shared");
        assert.deepEqual(calls.pushes, [{ tab: "shared" }]);
    });

    it("does not carry the tab to the next page", async () => {
        const { vm, calls, leave } = createPage({ search: { tab: "archived" } });
        await vm.ready;
        leave();
        assert.deepEqual(calls.replaces, [{}]);
    });

    it("shows 20 rows, then more on request", async () => {
        const { vm } = createPage();
        await vm.ready;
        vm.tables.mine = Array.from({ length: 45 }, (_, index) => ({ id: index }));
        assert.equal(vm.getVisibleRows("mine").length, 20);
        assert.equal(vm.hasMoreRows("mine"), true);
        vm.showMore("mine");
        vm.showMore("mine");
        assert.equal(vm.getVisibleRows("mine").length, 45);
        assert.equal(vm.hasMoreRows("mine"), false);
    });
});

describe("designs page, row actions", () => {
    it("edits a ready design and fixes one with errors in the editor", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        await vm.runAction(rowOf(vm, 1), rowOf(vm, 1).primary);
        await vm.runAction(rowOf(vm, 2), rowOf(vm, 2).primary);
        assert.deepEqual(calls.navigated, ["/designs/1/edit", "/designs/2/edit"]);
    });

    it("duplicates a design in use and opens the copy in the editor", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        const row = rowOf(vm, 3);
        assert.equal(row.primary.id, "duplicate-to-edit");
        await vm.runAction(row, row.primary);
        assert.deepEqual(calls.duplicated, [3]);
        assert.deepEqual(calls.navigated, ["/designs/99/edit"]);
    });

    it("stays on the page and says so when the duplicate fails", async () => {
        const originalError = console.error;
        console.error = () => {};
        try {
            const { vm, calls, settle } = createPage({
                catalog: { duplicateDesign: async () => { throw new Error("nope"); } },
            });
            await vm.ready;
            await vm.runAction(rowOf(vm, 3), rowOf(vm, 3).primary);
            await settle();
            assert.deepEqual(calls.navigated, []);
            assert.deepEqual(calls.toasts, ["designs_duplicate_failed"]);
        } finally {
            console.error = originalError;
        }
    });

    it("archives from the menu and restores from the Archived tab", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        const archive = rowOf(vm, 1).menu.find(entry => entry.id === "archive");
        await vm.runAction(rowOf(vm, 1), archive);
        const archived = rowOf(vm, 4, "archived");
        await vm.runAction(archived, archived.primary);
        assert.deepEqual(calls.archived, [[1, true], [4, false]]);
    });

    it("views a design from the menu", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        await vm.runAction(rowOf(vm, 2), rowOf(vm, 2).menu[0]);
        assert.deepEqual(calls.navigated, ["/designs/2"]);
    });

    it("does not delete a design in use, and explains a refused delete", async () => {
        const { vm, calls, settle } = createPage({
            catalog: {
                deleteDesign: async (id) => {
                    calls.deleted.push(id);
                    throw { data: { code: "DESIGN_IN_USE" } };
                },
            },
        });
        await vm.ready;
        await vm.runAction(rowOf(vm, 3), rowOf(vm, 3).menu.at(-1));
        assert.deepEqual(calls.deleted, [], "disabled for a design in use");

        await vm.runAction(rowOf(vm, 1), rowOf(vm, 1).menu.at(-1));
        await settle();
        assert.deepEqual(calls.deleted, [1]);
        assert.deepEqual(calls.toasts, ["design_delete_in_use"]);
    });
});

describe("designs page, sharing", () => {
    it("toggles sharing through the publication service", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        assert.equal(vm.isShared(rowOf(vm, 3)), true);
        await vm.toggleSharing(rowOf(vm, 1));
        assert.deepEqual(calls.toggled, [1]);
    });

    it("does not share a design with errors", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        await vm.toggleSharing(rowOf(vm, 2));
        assert.deepEqual(calls.toggled, []);
    });

    it("warns when the case was not published", async () => {
        const { vm, calls, settle } = createPage({
            publication: { togglePublicVisibility: async () => ({ status: "case_not_ready" }) },
        });
        await vm.ready;
        await vm.toggleSharing(rowOf(vm, 1));
        await settle();
        assert.deepEqual(calls.toasts, ["case_publication_settings_not_public"]);
    });
});

describe("designs page, Shared by others", () => {
    const sharedRow = (vm, id) => vm.getRows("shared").find(row => row.id === id);

    it("gives each shared design its import state", async () => {
        const { vm } = createPage({ search: { tab: "shared" } });
        await vm.ready;
        assert.deepEqual(vm.getRows("shared").map(row => [row.id, row.importState]),
            [[6, "not-importable"], [5, "importable"]]);
    });

    it("searches over the title, author, case and tags", async () => {
        const { vm } = createPage({ search: { tab: "shared" } });
        await vm.ready;
        vm.sharedSearch = "closed";
        vm.handleSharedSearchChange();
        assert.deepEqual(vm.getRows("shared").map(row => row.id), [6]);
        assert.equal(vm.count("shared"), 2);
    });

    it("imports a design, turns its row Imported and names the copy in a notice", async () => {
        mock.timers.enable({ apis: ["setTimeout"] });
        try {
            const { vm, calls } = createPage({ search: { tab: "shared" } });
            await vm.ready;
            await vm.importDesign(sharedRow(vm, 5));
            assert.deepEqual(calls.imported, [5]);
            assert.equal(sharedRow(vm, 5).importState, "imported");
            assert.equal(sharedRow(vm, 5).copyId, 99);
            assert.deepEqual(vm.importNotice, { copyId: 99, title: "Theirs (copy)" });
            assert.equal(vm.count("mine"), 4);
            assert.deepEqual(calls.toasts, []);
            mock.timers.tick(10 * 1000);
            assert.equal(vm.importNotice, null);
        } finally {
            mock.timers.reset();
        }
    });

    it("does not import a design already imported or one that cannot be", async () => {
        const { vm, calls } = createPage({ search: { tab: "shared" } });
        await vm.ready;
        await vm.importDesign(sharedRow(vm, 6));
        await vm.importDesign(sharedRow(vm, 5));
        await vm.importDesign(sharedRow(vm, 5));
        assert.deepEqual(calls.imported, [5]);
        vm.dismissImportNotice();
    });

    it("opens the copy in the editor or in My designs from the notice", async () => {
        const { vm, calls } = createPage({ search: { tab: "shared" } });
        await vm.ready;
        await vm.importDesign(sharedRow(vm, 5));
        vm.editImportedCopy();
        assert.deepEqual(calls.navigated, ["/designs/99/edit"]);
        assert.equal(vm.importNotice, null);

        vm.importNotice = { copyId: 99, title: "Theirs (copy)" };
        vm.showImportedCopyInMyDesigns();
        assert.equal(vm.tab, "mine");
        assert.equal(vm.importNotice, null);
        vm.dismissImportNotice();
    });

    it("explains a refused import and reloads the list", async () => {
        const refusal = Object.assign(new Error("refused"),
            { data: { code: "DESIGN_CASE_NOT_IMPORTABLE" } });
        const { vm, calls } = createPage({
            search:  { tab: "shared" },
            catalog: { importDesign: async () => { throw refusal; } },
        });
        await vm.ready;
        calls.reloads.length = 0;
        await vm.importDesign(sharedRow(vm, 5));
        assert.deepEqual(calls.toasts, ["design_import_blocked_by_case"]);
        assert.deepEqual(calls.reloads, [true]);
        assert.equal(vm.importNotice, null);
        assert.equal(vm.busy[5], undefined);
    });

    it("says when an import fails", async () => {
        const { vm, calls } = createPage({
            search:  { tab: "shared" },
            catalog: { importDesign: async () => { throw new Error("boom"); } },
        });
        await vm.ready;
        await vm.importDesign(sharedRow(vm, 5));
        assert.deepEqual(calls.toasts, ["design_import_error"]);
    });
});

describe("designs page template", () => {
    it("uses its own controller and offers no launch action", () => {
        assert.match(template, /ng-controller="DesignsPageController as dp"/u);
        assert.doesNotMatch(template, /BrowseDesignsController/u);
        assert.doesNotMatch(template, /on-launch|handleLaunch|launch_activity_button_text/u);
    });

    it("links the role line to Launch activity and the title to the design's view", () => {
        assert.match(template, /href="#!\/activities\/new"/u);
        assert.match(template, /class="designs-row-title" ng-href="#!\/designs\/\{\{ row\.id \}\}"/u);
    });

    it("keeps the tab in the links' URLs", () => {
        assert.match(template, /href="#!\/designs\?tab=shared"/u);
        assert.match(template, /href="#!\/designs\?tab=archived"/u);
    });

    it("draws the sharing switch and the row menu for assistive technology", () => {
        assert.match(template, /role="switch"/u);
        assert.match(template, /aria-checked=/u);
        assert.match(template, /uib-dropdown keyboard-nav/u);
        assert.match(template, /role="menuitem"/u);
    });

    it("lists shared designs in a table, not in design-item cards", () => {
        assert.doesNotMatch(template, /<design-item/u);
        assert.match(template, /class="designs-table designs-shared-table"/u);
        assert.match(template, /ng-click="dp\.importDesign\(row\)"/u);
        assert.match(template, /ng-href="#!\/designs\/\{\{ row\.copyId \}\}"/u);
        assert.match(template, /disabled\s+aria-describedby="designs-import-reason-/u);
        assert.match(template, /class="designs-import-notice" role="status"/u);
    });

    it("shows no design type", () => {
        assert.doesNotMatch(template, /design_type|semantic_differential|ranking/u);
    });
});

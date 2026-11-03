// The Cases page (#1013, epic #1008): the tab lives in the URL, rows run
// their actions through the catalog, and the share switch keeps the
// publication dialog. AngularJS services are fakes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CasesPageController } from "../cases-page.controller.js";

const fragment = name => readFileSync(new URL(
    `../../../../static/views/teacher/fragments/${name}.template.html`, import.meta.url), "utf8");
const template = readFileSync(new URL(
    "../../../../static/views/teacher/cases.index.html", import.meta.url), "utf8");

const NO_USE = { activityCount: 0, ownDesignCount: 0, otherDesignCount: 0, otherTeacherCount: 0 };

function own(id, title, fields = {}) {
    return {
        id, title, visibility:   "private", public:       false, languageCode: "es_CL",
        createdAt:    `2026-10-${String(10 + id).padStart(2, "0")}T00:00:00Z`,
        usage:        { ...NO_USE }, ...fields,
    };
}

function makeCases() {
    return {
        own: [
            own(1, "Ready"),
            own(2, "Processing", { documentProcessing: { status: "processing" } }),
            own(3, "Broken PDF", { documentProcessing: { status: "failed" } }),
            own(4, "Used", { usage: { ...NO_USE, activityCount: 2, ownDesignCount: 1 } }),
            own(5, "Kept by others", {
                visibility: "public", public:     true,
                usage:      { ...NO_USE, otherDesignCount: 3, otherTeacherCount: 2 },
            }),
        ],
        archived: [own(6, "Gone", { archived: true })],
        shared:   [{ id: 7, title: "Theirs", visibility: "public", public: true }],
    };
}

function createPage({ search = {}, catalog = {}, confirmAnswer = true } = {}) {
    const scopeHandlers = {};
    const calls = {
        navigated:  [], toasts:     [], pushes:     [], replaces:   [], duplicated: [],
        archived:   [], deleted:    [], visibility: [], imported:   [], confirms:   0,
        polled:     [], intervals:  [], cancelled:  [],
    };
    let current = { ...search };
    const lists = makeCases();

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
    const $translate = {
        instant: (key, values) => (values ? `${key}(${values.count})` : key),
    };
    // Intervals run only when the test says so.
    const $interval = (fn, delay) => {
        const timer = { fn, delay };
        calls.intervals.push(timer);
        return timer;
    };
    $interval.cancel = timer => calls.cancelled.push(timer);
    const toast = { create: options => calls.toasts.push(options) };

    const CasesCatalogService = {
        getCases:                  async () => lists.own,
        getPublicCases:            async () => lists.shared,
        getArchivedCases:          async () => lists.archived,
        getCaseDocumentProcessing: async (id) => {
            calls.polled.push(id);
            return { documentProcessing: { status: "completed", pageCount: 4 } };
        },
        duplicateCase: async (id) => {
            calls.duplicated.push(id);
            const copy = own(99, "Copy");
            lists.own = [...lists.own, copy];
            return copy;
        },
        updateCaseArchived: async (id, archived) => {
            calls.archived.push([id, archived]);
        },
        deleteCase: async (id) => {
            calls.deleted.push(id);
        },
        updateCaseVisibility: async (id, visibility) => {
            calls.visibility.push([id, visibility]);
            return { id, visibility, public: visibility === "public", affectedDesignIds: [] };
        },
        importCase: async (id) => {
            calls.imported.push(id);
            return own(98, "Theirs (copy)", { importedFromCaseId: id });
        },
        ...catalog,
    };
    const LanguageCatalogService = {
        getLanguages: async () => [{ code: "es_CL", native_name: "Español" }],
    };
    const CasePublicationNoticeService = {
        confirm: async () => {
            calls.confirms += 1;
            return confirmAnswer;
        },
    };

    const vm = {};
    CasesPageController.call(vm, $scope, $location, $translate, $interval, toast,
        CasesCatalogService, LanguageCatalogService, CasePublicationNoticeService);

    return {
        vm,
        calls,
        lists,
        // Angular's route update after a search change (Back, Forward, a tab link).
        visit(nextSearch) {
            current = { ...nextSearch };
            (scopeHandlers.$routeUpdate || []).forEach(handler => handler());
        },
        leave() {
            (scopeHandlers.$routeChangeStart || []).forEach(handler => handler());
        },
        destroy() {
            (scopeHandlers.$destroy || []).forEach(handler => handler());
        },
    };
}

const rowOf = (vm, id, tab = "mine") => vm.getRows(tab).find(row => row.id === id);
const entryOf = (row, id) => row.menu.find(entry => entry.id === id);
const toastMessages = calls => calls.toasts.map(entry => entry.message);

function quietly(run) {
    const originalError = console.error;
    console.error = () => {};
    return Promise.resolve(run()).finally(() => {
        console.error = originalError;
    });
}

describe("cases page, tabs", () => {
    it("opens My cases by default, newest first, and counts each tab", async () => {
        const { vm } = createPage();
        await vm.ready;
        assert.equal(vm.tab, "mine");
        assert.deepEqual(vm.getRows("mine").map(row => row.id), [5, 4, 3, 2, 1]);
        assert.equal(vm.count("mine"), 5);
        assert.equal(vm.count("shared"), 1);
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

    it("opens Shared by others from Import a shared case, adding a history entry", async () => {
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

    it("says when the cases cannot be loaded", async () => {
        await quietly(async () => {
            const { vm } = createPage({
                catalog: { getCases: async () => { throw new Error("down"); } },
            });
            await vm.ready;
            assert.equal(vm.loaded, true);
            assert.equal(vm.loadFailed, true);
        });
    });
});

describe("cases page, search and status filters", () => {
    const mineIds = vm => vm.getRows("mine").map(row => row.id);
    const chipIds = vm => vm.getFilterChips().map(chip => chip.id);

    it("lists every case of My cases under All, with the PDF errors counted", async () => {
        const { vm } = createPage();
        await vm.ready;
        assert.equal(vm.statusFilter, "all");
        assert.equal(vm.search, "");
        assert.deepEqual(chipIds(vm), ["all", "ready", "in-use", "shared", "pdf-error"]);
        assert.equal(vm.getFilterChips().find(chip => chip.id === "pdf-error").count, 1);
        assert.deepEqual(mineIds(vm), [5, 4, 3, 2, 1]);
    });

    it("lists exactly the cases of each chip, a processing case under All only", async () => {
        const { vm } = createPage();
        await vm.ready;
        const listed = {};
        for (const filter of ["ready", "in-use", "shared", "pdf-error"]) {
            vm.selectStatusFilter(filter);
            listed[filter] = mineIds(vm);
        }
        assert.deepEqual(listed, {
            "ready":     [5, 1],
            "in-use":    [4],
            "shared":    [5],
            "pdf-error": [3],
        });
    });

    it("hides PDF error when no case has one", async () => {
        const { vm } = createPage({
            catalog: { getCases: async () => [own(1, "Ready"), own(2, "Also ready")] },
        });
        await vm.ready;
        assert.deepEqual(chipIds(vm), ["all", "ready", "in-use", "shared"]);
    });

    it("opens the URL's filter and search, as after a reload or Back from a case", async () => {
        const { vm } = createPage({ search: { status: "in-use" } });
        await vm.ready;
        assert.equal(vm.statusFilter, "in-use");
        assert.deepEqual(mineIds(vm), [4]);
        assert.equal(vm.count("mine"), 5, "the tab still counts every case");

        const searched = createPage({ search: { status: "shared", q: "kept" } });
        await searched.vm.ready;
        assert.equal(searched.vm.search, "kept");
        assert.deepEqual(mineIds(searched.vm), [5]);

        const unknown = createPage({ search: { status: "processing" } });
        await unknown.vm.ready;
        assert.equal(unknown.vm.statusFilter, "all");
    });

    it("searches the titles, authors and tags without accents or case", async () => {
        const { vm } = createPage({
            catalog: {
                getCases: async () => [
                    own(1, "Ética en la IA", {
                        authors: [{ authorFirstname: "Camila", authorLastname: "Núñez" }],
                    }),
                    own(2, "Datos de pacientes", { tags: [{ label: "Salud pública" }] }),
                ],
            },
            search: { q: "ETICA" },
        });
        await vm.ready;
        assert.deepEqual(mineIds(vm), [1]);
        for (const [query, expected] of [["nunez", [1]], ["salud publica", [2]], ["zzz", []]]) {
            vm.search = query;
            vm.handleSearchChange();
            assert.deepEqual(mineIds(vm), expected, query);
        }
    });

    it("applies the filters to My cases only", async () => {
        const { vm } = createPage({ search: { status: "in-use", q: "zzz" } });
        await vm.ready;
        assert.deepEqual(vm.getRows("archived").map(row => row.id), [6]);
        assert.equal(vm.getRows("shared").length, 1);
    });

    it("adds a history entry for a chip and replaces it while typing", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        vm.selectStatusFilter("in-use");
        assert.deepEqual(calls.pushes, [{ status: "in-use" }]);

        vm.search = "  used ";
        vm.handleSearchChange();
        assert.deepEqual(calls.replaces, [{ status: "in-use", q: "used" }]);
        assert.deepEqual(mineIds(vm), [4]);

        vm.search = " ";
        vm.handleSearchChange();
        assert.deepEqual(calls.replaces.at(-1), { status: "in-use" });

        vm.selectStatusFilter("all");
        assert.deepEqual(calls.pushes.at(-1), {});
    });

    it("follows the URL on Back and Forward, keeping what is being typed", async () => {
        const { vm, visit } = createPage({ search: { status: "in-use" } });
        await vm.ready;
        visit({ status: "pdf-error", q: "broken" });
        assert.equal(vm.statusFilter, "pdf-error");
        assert.equal(vm.search, "broken");
        assert.deepEqual(mineIds(vm), [3]);

        vm.search = "broken ";
        visit({ status: "pdf-error", q: "broken" });
        assert.equal(vm.search, "broken ", "the trailing space survives the URL update");

        visit({});
        assert.equal(vm.statusFilter, "all");
        assert.equal(vm.search, "");
    });

    it("starts again from the first rows when a filter changes", async () => {
        const { vm, visit } = createPage();
        await vm.ready;
        vm.showMore("mine");
        vm.selectStatusFilter("ready");
        assert.equal(vm.visibleCounts.mine, 20);

        vm.showMore("mine");
        vm.search = "ready";
        vm.handleSearchChange();
        assert.equal(vm.visibleCounts.mine, 20);

        vm.showMore("mine");
        visit({ status: "shared" });
        assert.equal(vm.visibleCounts.mine, 20);
    });

    it("clears the filter and the search", async () => {
        const { vm, calls } = createPage({ search: { status: "in-use", q: "zzz" } });
        await vm.ready;
        assert.deepEqual(vm.getRows("mine"), []);
        vm.clearFilters();
        assert.equal(vm.statusFilter, "all");
        assert.equal(vm.search, "");
        assert.deepEqual(calls.pushes.at(-1), {});
        assert.equal(vm.getRows("mine").length, 5);
    });

    it("clears the filters when switching tabs, as the tabs' links do", async () => {
        const { vm, calls } = createPage({ search: { status: "in-use", q: "used" } });
        await vm.ready;
        vm.openSharedTab();
        assert.deepEqual(calls.pushes.at(-1), { tab: "shared" });
        assert.equal(vm.statusFilter, "all");
        assert.equal(vm.search, "");
    });

    it("does not carry the filter and the search to the next page", async () => {
        const { vm, calls, leave } = createPage({
            search: { tab: "mine", status: "in-use", q: "x" },
        });
        await vm.ready;
        leave();
        assert.deepEqual(calls.replaces.at(-1), {});
    });
});

describe("cases page, rows", () => {
    it("names each case's language and chooses its action by status", async () => {
        const { vm } = createPage();
        await vm.ready;
        assert.deepEqual(rowOf(vm, 1).meta, [{ text: "Español" }]);
        assert.deepEqual([1, 2, 3, 4].map(id => rowOf(vm, id).primary.id),
            ["edit", "edit", "replace-pdf", "duplicate-to-edit"]);
        assert.equal(rowOf(vm, 6, "archived").primary.id, "restore");
        assert.equal(entryOf(rowOf(vm, 4), "delete").disabled, true);
        assert.equal(entryOf(rowOf(vm, 5), "delete").reason.key, "cases_delete_used_by_others_other");
    });
});

describe("cases page, row actions", () => {
    it("opens the editor to edit a case or replace its PDF, and views one from the menu", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        await vm.runAction(rowOf(vm, 1), rowOf(vm, 1).primary);
        await vm.runAction(rowOf(vm, 3), rowOf(vm, 3).primary);
        await vm.runAction(rowOf(vm, 2), entryOf(rowOf(vm, 2), "view"));
        assert.deepEqual(calls.navigated, ["/cases/1/edit", "/cases/3/edit", "/cases/2"]);
    });

    it("duplicates a case in use and opens the copy in the editor", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        await vm.runAction(rowOf(vm, 4), rowOf(vm, 4).primary);
        assert.deepEqual(calls.duplicated, [4]);
        assert.deepEqual(calls.navigated, ["/cases/99/edit"]);
    });

    it("stays on the page and says so when Duplicate to edit fails", async () => {
        await quietly(async () => {
            const { vm, calls } = createPage({
                catalog: { duplicateCase: async () => { throw new Error("nope"); } },
            });
            await vm.ready;
            await vm.runAction(rowOf(vm, 4), rowOf(vm, 4).primary);
            assert.deepEqual(calls.navigated, []);
            assert.deepEqual(toastMessages(calls), ["ethical_cases_duplicate_error"]);
            assert.deepEqual(vm.busy, {});
        });
    });

    it("duplicates from the menu, staying on the tab with the copy listed", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        await vm.runAction(rowOf(vm, 1), entryOf(rowOf(vm, 1), "duplicate"));
        assert.deepEqual(calls.navigated, []);
        assert.equal(vm.tab, "mine");
        assert.ok(rowOf(vm, 99));
        assert.deepEqual(toastMessages(calls), ["ethical_cases_duplicate_success"]);
    });

    it("archives from the menu and restores from the Archived tab", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        await vm.runAction(rowOf(vm, 1), entryOf(rowOf(vm, 1), "archive"));
        const archived = rowOf(vm, 6, "archived");
        await vm.runAction(archived, archived.primary);
        assert.deepEqual(calls.archived, [[1, true], [6, false]]);
        assert.deepEqual(toastMessages(calls),
            ["ethical_cases_archive_success", "ethical_cases_unarchive_success"]);
        assert.equal(vm.tab, "mine");
    });

    it("deletes a case nobody else uses, and not one that is disabled", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        await vm.runAction(rowOf(vm, 4), entryOf(rowOf(vm, 4), "delete"));
        await vm.runAction(rowOf(vm, 5), entryOf(rowOf(vm, 5), "delete"));
        assert.deepEqual(calls.deleted, []);
        await vm.runAction(rowOf(vm, 1), entryOf(rowOf(vm, 1), "delete"));
        assert.deepEqual(calls.deleted, [1]);
        assert.deepEqual(toastMessages(calls), ["ethical_cases_delete_success"]);
    });

    it("explains a refused delete", async () => {
        await quietly(async () => {
            const { vm, calls } = createPage({
                catalog: {
                    deleteCase: async () => {
                        throw { data: { code: "CASE_USED_BY_OTHER_TEACHERS" } };
                    },
                },
            });
            await vm.ready;
            await vm.runAction(rowOf(vm, 1), entryOf(rowOf(vm, 1), "delete"));
            assert.deepEqual(toastMessages(calls), ["cases_delete_refused_other_teachers"]);
        });
    });

    it("runs one action at a time per case", async () => {
        let release;
        const { vm, calls } = createPage({
            catalog: {
                updateCaseArchived: (id, archived) => new Promise((resolve) => {
                    calls.archived.push([id, archived]);
                    release = resolve;
                }),
            },
        });
        await vm.ready;
        const row = rowOf(vm, 1);
        const first = vm.runAction(row, entryOf(row, "archive"));
        await vm.runAction(row, entryOf(row, "archive"));
        assert.equal(vm.busy[1], true);
        release();
        await first;
        assert.deepEqual(calls.archived, [[1, true]]);
        assert.deepEqual(vm.busy, {});
    });
});

describe("cases page, sharing", () => {
    it("asks before sharing a private case, then saves it", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        await vm.toggleSharing(rowOf(vm, 1));
        assert.equal(calls.confirms, 1);
        assert.deepEqual(calls.visibility, [[1, "public"]]);
        assert.equal(vm.isShared(rowOf(vm, 1)), true);
    });

    it("shares a case in use", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        assert.equal(rowOf(vm, 4).sharing.disabled, false);
        await vm.toggleSharing(rowOf(vm, 4));
        assert.deepEqual(calls.visibility, [[4, "public"]]);
    });

    it("changes nothing when the author cancels the publication", async () => {
        const { vm, calls } = createPage({ confirmAnswer: false });
        await vm.ready;
        await vm.toggleSharing(rowOf(vm, 1));
        assert.deepEqual(calls.visibility, []);
        assert.equal(vm.isShared(rowOf(vm, 1)), false);
    });

    it("stops sharing without asking, and tells how many designs keep the case", async () => {
        const { vm, calls } = createPage({
            catalog: {
                updateCaseVisibility: async (id, visibility) => {
                    calls.visibility.push([id, visibility]);
                    return { id, visibility, public: false, affectedDesignIds: [8], designsKeepingAccess: 3 };
                },
            },
        });
        await vm.ready;
        await vm.toggleSharing(rowOf(vm, 5));
        assert.equal(calls.confirms, 0);
        assert.deepEqual(calls.visibility, [[5, "private"]]);
        assert.deepEqual(toastMessages(calls), [
            "ethical_cases_designs_made_private_one(1) ethical_cases_designs_keeping_access_other(3)",
        ]);
    });

    it("puts the switch back and says so when the save fails", async () => {
        await quietly(async () => {
            const { vm, calls } = createPage({
                catalog: { updateCaseVisibility: async () => { throw new Error("nope"); } },
            });
            await vm.ready;
            await vm.toggleSharing(rowOf(vm, 5));
            assert.equal(vm.isShared(rowOf(vm, 5)), true);
            assert.deepEqual(toastMessages(calls), ["ethical_cases_save_error"]);
            assert.deepEqual(vm.busy, {});
        });
    });

    it("does not change the sharing of an archived case", async () => {
        const { vm, calls } = createPage({ search: { tab: "archived" } });
        await vm.ready;
        await vm.toggleSharing(rowOf(vm, 6, "archived"));
        assert.deepEqual(calls.visibility, []);
    });
});

describe("cases page, document processing", () => {
    it("refreshes the cases being processed until they are done", async () => {
        const { vm, calls, destroy } = createPage();
        await vm.ready;
        assert.equal(calls.intervals.length, 1);
        await vm.refreshDocumentProcessing();
        assert.deepEqual(calls.polled, [2]);
        assert.equal(rowOf(vm, 2).status.tone, "ready");
        assert.deepEqual(rowOf(vm, 2).meta[0], { key: "cases_meta_pages_other", params: { count: 4 } });
        assert.deepEqual(calls.cancelled, [calls.intervals[0]]);
        destroy();
        assert.equal(calls.cancelled.length, 1);
    });
});

describe("cases page, Shared by others", () => {
    it("imports a case and opens My cases, as the previous page did", async () => {
        const { vm, calls } = createPage({ search: { tab: "shared" } });
        await vm.ready;
        await vm.importCase(vm.getRows("shared")[0]);
        assert.deepEqual(calls.imported, [7]);
        assert.deepEqual(toastMessages(calls), ["ethical_cases_import_success"]);
        assert.equal(vm.tab, "mine");
    });

    it("views a shared case", async () => {
        const { vm, calls } = createPage({ search: { tab: "shared" } });
        await vm.ready;
        vm.viewCase(vm.getRows("shared")[0]);
        assert.deepEqual(calls.navigated, ["/cases/7"]);
    });
});

describe("cases page template", () => {
    it("uses its own controller and keeps each tab in its own fragment", () => {
        assert.match(template, /ng-controller="CasesPageController as cp"/u);
        assert.doesNotMatch(template, /CasesController/u);
        for (const name of ["cases-own-tab", "cases-shared-tab", "cases-archived-tab"]) {
            assert.match(template, new RegExp(`fragments/${name}\\.template\\.html`, "u"));
        }
        assert.match(fragment("cases-own-tab"), /fragments\/cases-table\.template\.html/u);
        assert.match(fragment("cases-archived-tab"), /fragments\/cases-table\.template\.html/u);
        assert.match(fragment("cases-table"), /fragments\/case-row-menu\.template\.html/u);
    });

    it("puts the tab in the URL and links the role line to a new design", () => {
        assert.match(template, /href="#!\/cases"/u);
        assert.match(template, /href="#!\/cases\?tab=shared"/u);
        assert.match(template, /href="#!\/cases\?tab=archived"/u);
        assert.match(template, /href="#!\/designs\/new"/u);
    });

    it("draws the search and the status chips in My cases, and a state for no matches", () => {
        const mine = fragment("cases-own-tab");
        assert.match(mine, /ng-model="cp\.search"/u);
        assert.match(mine, /ng-change="cp\.handleSearchChange\(\)"/u);
        assert.match(mine, /ng-repeat="chip in cp\.getFilterChips\(\) track by chip\.id"/u);
        assert.match(mine, /aria-pressed=/u);
        assert.match(mine, /class="cases-no-matches" role="status"/u);
        assert.match(mine, /ng-click="cp\.clearFilters\(\)"/u);
        assert.doesNotMatch(fragment("cases-archived-tab"), /getFilterChips|cp\.search/u);
    });

    it("draws the rows with a title link, a switch and a menu", () => {
        const table = fragment("cases-table");
        assert.match(table, /class="cases-row-title" ng-href="#!\/cases\/\{\{ row\.id \}\}"/u);
        assert.match(table, /role="switch"/u);
        assert.match(table, /aria-checked=/u);
        assert.match(table, /ng-click="cp\.toggleSharing\(row\)"/u);
        const menu = fragment("case-row-menu");
        assert.match(menu, /uib-dropdown keyboard-nav/u);
        assert.match(menu, /role="menuitem"/u);
    });

    it("keeps the case cards in Shared by others", () => {
        const shared = fragment("cases-shared-tab");
        assert.match(shared, /<case-card/u);
        assert.match(shared, /on-import="cp\.importCase"/u);
    });
});

// The search and status filters of the Activities page (#1051, epic #1046):
// they live in the URL beside the tab, survive a reload and Back (also from
// the dashboard), filter the rows that "Show more" counts, change the footer
// of "Sin iniciar", and are cleared by switching tabs. AngularJS services are
// fakes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ActivitiesPageController } from "../activities-page.controller.js";

const VIEWS = new URL("../../../../static/views/teacher/", import.meta.url);
const read = path => readFileSync(new URL(path, VIEWS), "utf8");

function activity(sessionId, fields = {}) {
    return {
        sessionId,
        name:             `Activity ${sessionId}`,
        description:      "",
        time:             new Date(Date.UTC(2026, 9, 1, 0, sessionId)).toISOString(),
        code:             `k${sessionId}`,
        archived:         false,
        status:           "in_progress",
        designId:         40,
        design:           { metainfo: { title: `Activity ${sessionId}` } },
        caseId:           null,
        caseTitle:        null,
        currentPhase:     { number: 1, mode: "individual" },
        phaseCount:       2,
        participantCount: 3,
        finishedAt:       null,
        ...fields,
    };
}

// 25 activities not started (1-25), 5 in progress (26-30), one finished (31)
// and one archived (32).
function makeActivities() {
    const list = [];
    for (let id = 1; id <= 25; id += 1) {
        list.push(activity(id, { status: "initiated", currentPhase: null }));
    }
    for (let id = 26; id <= 30; id += 1) {
        list.push(activity(id));
    }
    list.push(activity(31, {
        status: "finished", currentPhase: null, name: "Ética médica", code: "FIN31",
    }));
    list.push(activity(32, { status: "finished", currentPhase: null, archived: true }));
    list[0].name = "Privacidad en salud";
    list[0].caseId = 7;
    list[0].caseTitle = "El caso Núñez";
    return list;
}

function createPage({ search = {} } = {}) {
    const scopeHandlers = {};
    const calls = { pushes: [], replaces: [] };
    let current = { ...search };
    const activities = makeActivities();

    const $scope = {
        $on(name, handler) {
            (scopeHandlers[name] ||= []).push(handler);
        },
        $applyAsync(fn) {
            fn?.();
        },
        navigateTo() {},
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
    const $rootScope = { $on: () => () => {} };
    const $translate = { use: () => "es_CL" };
    const $window = { navigator: {} };
    const ActivityCatalogService = {
        getActivities:      () => activities,
        loadActivities:     async () => activities,
        registerListener:   () => {},
        unregisterListener: () => {},
    };

    const vm = {};
    ActivitiesPageController.call(vm, $scope, $rootScope, $location, $translate, $window,
        ActivityCatalogService);

    return {
        vm,
        calls,
        url: () => ({ ...current }),
        // Angular's route update after a search change (Back, Forward, a link).
        visit(nextSearch) {
            current = { ...nextSearch };
            (scopeHandlers.$routeUpdate || []).forEach(handler => handler());
        },
        leave() {
            (scopeHandlers.$routeChangeStart || []).forEach(handler => handler());
        },
    };
}

const rowIds = (vm, tab) => vm.getRows(tab).map(row => row.id);

describe("activities page, search", () => {
    it("finds an activity by its name, case or code", async () => {
        const { vm } = createPage({ search: { q: "privacidad" } });
        await vm.ready;
        assert.deepEqual(rowIds(vm, "ongoing"), [1]);
        vm.search = "nunez";
        assert.deepEqual(rowIds(vm, "ongoing"), [1]);
        vm.search = "K27";
        assert.deepEqual(rowIds(vm, "ongoing"), [27]);
    });

    it("keeps the search in the URL, replacing the history entry", async () => {
        const { vm, calls, url } = createPage();
        await vm.ready;
        vm.search = "  ética ";
        vm.handleSearchChange();
        assert.deepEqual(url(), { q: "ética" });
        assert.deepEqual(calls.pushes, []);
        vm.search = "";
        vm.handleSearchChange();
        assert.deepEqual(url(), {});
    });

    it("searches the other tabs too, from the URL", async () => {
        const { vm } = createPage({ search: { tab: "finished", q: "fin31" } });
        await vm.ready;
        assert.equal(vm.tab, "finished");
        assert.deepEqual(rowIds(vm, "finished"), [31]);
        assert.equal(vm.count("finished"), 1);
    });
});

describe("activities page, status filters", () => {
    it("opens the URL's filter, as after a reload or Back", async () => {
        const { vm } = createPage({ search: { status: "in-progress" } });
        await vm.ready;
        assert.equal(vm.statusFilter, "in-progress");
        assert.deepEqual(rowIds(vm, "ongoing"), [30, 29, 28, 27, 26]);
        assert.equal(vm.count("ongoing"), 30, "the tab counts every activity");
    });

    it("counts the activities with no phase started in the Sin iniciar chip", async () => {
        const { vm } = createPage({ search: { q: "privacidad" } });
        await vm.ready;
        const chips = vm.getFilterChips("ongoing");
        assert.deepEqual(chips.map(chip => [chip.id, chip.count]),
            [["all", null], ["not-started", 25], ["in-progress", null]]);
        assert.deepEqual(vm.getFilterChips("finished"), []);
    });

    it("adds a history entry per chip, none for Todas", async () => {
        const { vm, calls, url } = createPage();
        await vm.ready;
        vm.selectStatusFilter("not-started");
        assert.deepEqual(url(), { status: "not-started" });
        vm.selectStatusFilter("not-started");
        vm.selectStatusFilter("all");
        assert.deepEqual(calls.pushes, [{ status: "not-started" }, {}]);
    });

    it("ignores the status filter outside En curso", async () => {
        const { vm } = createPage({ search: { tab: "finished", status: "not-started" } });
        await vm.ready;
        assert.deepEqual(rowIds(vm, "finished"), [31]);
    });
});

describe("activities page, filters and show more", () => {
    it("shows 20 filtered rows, then the rest, and says how many are not started", async () => {
        const { vm } = createPage({ search: { status: "not-started" } });
        await vm.ready;
        assert.equal(vm.getRows("ongoing").length, 25);
        assert.equal(vm.getVisibleRows("ongoing").length, 20);
        assert.equal(vm.hasMoreRows("ongoing"), true);
        assert.deepEqual(vm.getOngoingFooter(), {
            showingKey: "activities_filter_showing_not_started",
            hintKey:    "activities_filter_hint_not_started",
        });
        vm.showMore("ongoing");
        assert.equal(vm.getVisibleRows("ongoing").length, 25);
        assert.equal(vm.hasMoreRows("ongoing"), false);
    });

    it("has nothing more to show when the filter leaves fewer rows", async () => {
        const { vm } = createPage();
        await vm.ready;
        assert.equal(vm.hasMoreRows("ongoing"), true);
        vm.selectStatusFilter("in-progress");
        assert.equal(vm.hasMoreRows("ongoing"), false);
        assert.equal(vm.getOngoingFooter().showingKey, "activities_showing");
    });

    it("starts again from 20 rows when the filter changes", async () => {
        const { vm } = createPage();
        await vm.ready;
        vm.showMore("ongoing");
        vm.selectStatusFilter("not-started");
        assert.equal(vm.getVisibleRows("ongoing").length, 20);
    });
});

describe("activities page, empty results", () => {
    it("tells when the search leaves the tab empty, and clears it", async () => {
        const { vm, url } = createPage({ search: { status: "in-progress", q: "nothing" } });
        await vm.ready;
        assert.equal(vm.hasNoMatches("ongoing"), true);
        assert.equal(vm.getNoMatches("ongoing").clearKey, "activities_filter_clear");
        vm.clearFilters();
        assert.equal(vm.search, "");
        assert.equal(vm.statusFilter, "all");
        assert.deepEqual(url(), {});
        assert.equal(vm.hasNoMatches("ongoing"), false);
        assert.equal(vm.getRows("ongoing").length, 30);
    });

    it("offers to clear the search in Terminadas", async () => {
        const { vm } = createPage({ search: { tab: "finished", q: "nothing" } });
        await vm.ready;
        assert.equal(vm.hasNoMatches("finished"), true);
        assert.equal(vm.getNoMatches("finished").clearKey, "activities_search_clear");
    });
});

describe("activities page, filters in the history", () => {
    it("follows the URL on Back and Forward", async () => {
        const { vm, visit } = createPage();
        await vm.ready;
        visit({ status: "not-started", q: "privacidad" });
        assert.equal(vm.statusFilter, "not-started");
        assert.equal(vm.search, "privacidad");
        assert.deepEqual(rowIds(vm, "ongoing"), [1]);
        visit({});
        assert.equal(vm.statusFilter, "all");
        assert.equal(vm.search, "");
    });

    it("keeps what is being typed while it matches the URL", async () => {
        const { vm, visit } = createPage();
        await vm.ready;
        vm.search = "privacidad ";
        vm.handleSearchChange();
        visit({ q: "privacidad" });
        assert.equal(vm.search, "privacidad ");
    });

    it("clears the filters when switching tabs, as the tabs' links do", async () => {
        const { vm, url, visit } = createPage({ search: { status: "not-started", q: "x" } });
        await vm.ready;
        vm.selectTab("finished");
        assert.deepEqual(url(), { tab: "finished" });
        assert.equal(vm.search, "");
        assert.equal(vm.statusFilter, "all");

        visit({ status: "in-progress", q: "y" });
        visit({ tab: "archived" });
        assert.equal(vm.tab, "archived");
        assert.equal(vm.search, "");
        assert.equal(vm.statusFilter, "all");
    });

    it("does not carry the filters to the next page", async () => {
        const { vm, url, leave } = createPage({
            search: { tab: "finished", status: "in-progress", q: "ética" },
        });
        await vm.ready;
        leave();
        assert.deepEqual(url(), {});
    });

    it("restores them when coming back from the dashboard", async () => {
        // Back re-creates the page from its own history entry.
        const { vm } = createPage({ search: { status: "not-started", q: "privacidad" } });
        await vm.ready;
        assert.equal(vm.statusFilter, "not-started");
        assert.equal(vm.search, "privacidad");
        assert.deepEqual(rowIds(vm, "ongoing"), [1]);
    });
});

describe("activities page, filter templates", () => {
    const bar = read("fragments/activities-filters.template.html");
    const page = read("activity.index.html");
    const ongoing = read("fragments/activities-ongoing-tab.template.html");

    it("binds the search and the chips of En curso", () => {
        assert.match(bar, /ng-model="ap\.search"/);
        assert.match(bar, /ng-change="ap\.handleSearchChange\(\)"/);
        assert.match(bar, /ng-if="ap\.hasStatusFilter\(ap\.tab\)"/);
        assert.match(bar, /ap\.selectStatusFilter\(chip\.id\)/);
    });

    it("shows the empty results with a way to clear them", () => {
        assert.match(page, /ap\.hasNoMatches\(ap\.tab\)/);
        assert.match(page, /ng-click="ap\.clearFilters\(\)"/);
    });

    it("uses the filter's footer in En curso", () => {
        assert.match(ongoing, /ap\.getOngoingFooter\(\)\.showingKey/);
        assert.match(ongoing, /ap\.getOngoingFooter\(\)\.hintKey/);
    });
});

// The Activities page (#1050, epic #1046): the tab lives in the URL and
// survives a reload and Back, rows come from the activity catalog and follow
// it, each action leaves for its page or archives through the catalog, and
// each part of the page has its own fragment. AngularJS services are fakes.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ActivitiesPageController } from "../activities-page.controller.js";

const VIEWS = new URL("../../../../static/views/teacher/", import.meta.url);
const read = path => readFileSync(new URL(path, VIEWS), "utf8");

function activity(sessionId, fields = {}) {
    return {
        sessionId,
        name:             `Activity ${sessionId}`,
        description:      "",
        time:             `2026-10-${String(10 + sessionId).padStart(2, "0")}T12:00:00Z`,
        code:             `k${sessionId}`,
        archived:         false,
        status:           "in_progress",
        designId:         40 + sessionId,
        design:           { metainfo: { title: `Activity ${sessionId}` } },
        caseId:           7,
        caseTitle:        "Case",
        currentPhase:     { number: 1, mode: "individual" },
        phaseCount:       2,
        participantCount: 3,
        finishedAt:       null,
        ...fields,
    };
}

function makeActivities() {
    return [
        activity(1, { status: "initiated", currentPhase: null }),
        activity(2),
        activity(3, { status: "finished", currentPhase: null, finishedAt: "2026-10-20T12:00:00Z" }),
        activity(4, { status: "finished", currentPhase: null }),
        activity(5, { status: "finished", currentPhase: null, archived: true }),
    ];
}

function createPage({
    search = {}, catalog = {}, clipboard = null, language: initialLanguage = "es_CL",
} = {}) {
    const scopeHandlers = {};
    const calls = { navigated: [], pushes: [], replaces: [], archived: [], loads: 0, copied: [] };
    let current = { ...search };
    let activities = makeActivities();
    const listeners = {};

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
    let language = initialLanguage;
    const $translate = { use: () => language };
    // angular-translate emits its events on $rootScope, not on the page's scope.
    const rootHandlers = {};
    const $rootScope = {
        $on(name, handler) {
            (rootHandlers[name] ||= []).push(handler);
            return () => {
                rootHandlers[name] = rootHandlers[name].filter(item => item !== handler);
            };
        },
    };
    const $window = {
        navigator: {
            clipboard: clipboard || {
                writeText: async (text) => {
                    calls.copied.push(text);
                },
            },
        },
    };
    const notify = () => (listeners.onActivityCatalogUpdated || []).forEach(fn => fn());
    const ActivityCatalogService = {
        getActivities:  () => activities,
        loadActivities: async () => {
            calls.loads += 1;
            notify();
            return activities;
        },
        setArchived: async (sessionId, archived) => {
            calls.archived.push([sessionId, archived]);
            const target = activities.find(item => item.sessionId === sessionId);
            target.archived = archived;
            notify();
            return { id: sessionId, archived };
        },
        registerListener(name, fn) {
            (listeners[name] ||= []).push(fn);
        },
        unregisterListener(name, fn) {
            listeners[name] = (listeners[name] || []).filter(item => item !== fn);
        },
        ...catalog,
    };

    // The notices' timer (#1052), which these tests never fire.
    const $timeout = Object.assign(fn => ({ fn }), { cancel() {} });

    const vm = {};
    // The empty page's designs (#1053): none, as for a new teacher.
    const DesignCatalogService = { loadDesigns: async () => true, getDesigns: async () => [] };
    ActivitiesPageController.call(vm, $scope, $rootScope, $location, $translate, $window,
        ActivityCatalogService, $timeout, DesignCatalogService);

    return {
        vm,
        calls,
        listeners,
        rootHandlers,
        // The run block switching to the profile's language.
        switchLanguage(next) {
            language = next;
            (rootHandlers.$translateChangeSuccess || []).forEach(handler => handler());
        },
        setActivities(next) {
            activities = next;
        },
        notify,
        // Angular's route update after a search change (Back, Forward, a tab link).
        visit(nextSearch) {
            current = { ...nextSearch };
            (scopeHandlers.$routeUpdate || []).forEach(handler => handler());
        },
        leave() {
            (scopeHandlers.$routeChangeStart || []).forEach(handler => handler());
        },
        emit(name) {
            (scopeHandlers[name] || []).forEach(handler => handler());
        },
    };
}

const rowIds = (vm, tab) => vm.getRows(tab).map(row => row.id);
const rowOf = (vm, id, tab) => vm.getRows(tab).find(row => row.id === id);
const entryOf = (row, id) => row.menu.find(entry => entry.id === id);

function quietly(run) {
    const { error, warn } = console;
    console.error = () => {};
    console.warn = () => {};
    return Promise.resolve(run()).finally(() => {
        console.error = error;
        console.warn = warn;
    });
}

describe("activities page, tabs", () => {
    it("opens En curso by default, newest first, and counts each tab", async () => {
        const { vm } = createPage();
        await vm.ready;
        assert.equal(vm.loaded, true);
        assert.equal(vm.tab, "ongoing");
        assert.deepEqual(rowIds(vm, "ongoing"), [2, 1]);
        assert.deepEqual(rowIds(vm, "finished"), [4, 3]);
        assert.deepEqual(rowIds(vm, "archived"), [5]);
        assert.deepEqual([vm.count("ongoing"), vm.count("finished"), vm.count("archived")],
            [2, 2, 1]);
        assert.equal(vm.hasNoActivities(), false);
    });

    it("opens the URL's tab, as after a reload or Back from the dashboard", async () => {
        const { vm } = createPage({ search: { tab: "finished" } });
        await vm.ready;
        assert.equal(vm.tab, "finished");
    });

    it("follows the URL on Back and Forward", async () => {
        const { vm, visit } = createPage();
        await vm.ready;
        visit({ tab: "archived" });
        assert.equal(vm.tab, "archived");
        visit({});
        assert.equal(vm.tab, "ongoing");
    });

    it("adds a history entry when a tab is selected, none for En curso", async () => {
        const { vm, calls } = createPage({ search: { tab: "archived" } });
        await vm.ready;
        vm.selectTab("finished");
        vm.selectTab("finished");
        vm.selectTab("other");
        vm.selectTab("ongoing");
        assert.deepEqual(calls.pushes, [{ tab: "finished" }, {}]);
        assert.equal(vm.tab, "ongoing");
    });

    it("does not carry the tab to the next page", async () => {
        const { vm, calls, leave } = createPage({ search: { tab: "finished" } });
        await vm.ready;
        leave();
        assert.deepEqual(calls.replaces, [{}]);
    });

    it("gives each tab its columns", async () => {
        const { vm } = createPage();
        await vm.ready;
        assert.deepEqual(vm.columns.ongoing.map(column => column.id),
            ["activity", "status", "participants", "code", "launched"]);
        assert.deepEqual(vm.columns.archived.map(column => column.id),
            ["activity", "status", "participants", "finished"]);
    });

    it("tells a teacher with no activities", async () => {
        const { vm } = createPage({
            catalog: { getActivities: () => [], loadActivities: async () => [] },
        });
        assert.equal(vm.hasNoActivities(), false);
        await vm.ready;
        assert.equal(vm.hasNoActivities(), true);
    });
});

describe("activities page, rows", () => {
    it("shows 20 rows, then more on request", async () => {
        const many = Array.from({ length: 45 }, (_, index) => activity(index + 1));
        const { vm } = createPage({ catalog: { getActivities: () => many } });
        await vm.ready;
        assert.equal(vm.getVisibleRows("ongoing").length, 20);
        assert.equal(vm.hasMoreRows("ongoing"), true);
        vm.showMore("ongoing");
        vm.showMore("ongoing");
        assert.equal(vm.getVisibleRows("ongoing").length, 45);
        assert.equal(vm.hasMoreRows("ongoing"), false);
    });

    it("builds the rows again when the catalog changes", async () => {
        const { vm, setActivities, notify } = createPage();
        await vm.ready;
        setActivities([activity(9)]);
        notify();
        assert.deepEqual(rowIds(vm, "ongoing"), [9]);
        assert.equal(vm.count("finished"), 0);
    });

    it("says every date in the UI language, again when the profile's loads", async () => {
        // Finished a minute ago: "today" and the time.
        const now = new Date(Date.now() - 60 * 1000).toISOString();
        const page = createPage({
            language: "en_US",
            catalog:  {
                getActivities: () => [
                    activity(1, { status: "finished", currentPhase: null, finishedAt: now }),
                    activity(3, {
                        status: "finished", currentPhase: null, finishedAt: "2026-10-20T12:00:00Z",
                    }),
                ],
            },
        });
        await page.vm.ready;
        const cells = () => ({
            today: rowOf(page.vm, 1, "finished").finished.label,
            older: rowOf(page.vm, 3, "finished").finished.label.text,
            hint:  rowOf(page.vm, 3, "finished").finished.hint.text,
        });

        // The browser's language until the profile loads.
        // "Yesterday" just after midnight; either way it carries the time.
        assert.ok(["activity_date_today", "activity_date_yesterday"]
            .includes(cells().today.key));
        assert.match(cells().today.params.time, /^\d{1,2}:\d{2}\s[AP]M$/);
        assert.match(cells().older, /^Oct 20(, 2026)?, \d{1,2}:\d{2}\s[AP]M$/);
        assert.match(cells().hint, /October 20, 2026/);

        page.switchLanguage("es_CL");
        assert.match(cells().today.params.time, /^\d{2}:\d{2}$/);
        assert.match(cells().older, /^20 oct\.?( 2026)?,? \d{2}:\d{2}$/);
        assert.match(cells().hint, /20 de octubre de 2026/);
    });

    it("stops following the catalog and the language when the page goes away", async () => {
        const { vm, listeners, rootHandlers, emit } = createPage();
        await vm.ready;
        assert.equal(listeners.onActivityCatalogUpdated.length, 1);
        assert.equal(rootHandlers.$translateChangeSuccess.length, 1);
        emit("$destroy");
        assert.equal(listeners.onActivityCatalogUpdated.length, 0);
        assert.equal(rootHandlers.$translateChangeSuccess.length, 0);
    });
});

describe("activities page, row actions", () => {
    it("opens the dashboard, the reports, the design, the case and the wizard", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        const ongoing = rowOf(vm, 2, "ongoing");
        await vm.runAction(ongoing, ongoing.primary);
        await vm.runAction(ongoing, entryOf(ongoing, "reports"));
        await vm.runAction(ongoing, entryOf(ongoing, "view-design"));
        await vm.runAction(ongoing, entryOf(ongoing, "view-case"));
        const finished = rowOf(vm, 4, "finished");
        await vm.runAction(finished, finished.primary);
        await vm.runAction(finished, entryOf(finished, "launch-again"));
        assert.deepEqual(calls.navigated, [
            "/activities/2", "/activities/2/reports", "/designs/42", "/cases/7",
            "/activities/4/reports", "/activities/new/44",
        ]);
    });

    it("copies the code, from the menu or its button", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        const row = rowOf(vm, 2, "ongoing");
        await vm.runAction(row, entryOf(row, "copy-code"));
        assert.equal(await vm.copyCode(row), true);
        assert.deepEqual(calls.copied, ["k2", "k2"]);
    });

    it("answers false when the code cannot be copied", async () => {
        await quietly(async () => {
            const { vm } = createPage({
                clipboard: { writeText: async () => { throw new Error("denied"); } },
            });
            await vm.ready;
            assert.equal(await vm.copyCode(rowOf(vm, 2, "ongoing")), false);
            assert.equal(await vm.copyCode({ code: "" }), false);
        });
    });

    it("archives a finished activity and restores an archived one", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        const finished = rowOf(vm, 4, "finished");
        await vm.runAction(finished, entryOf(finished, "archive"));
        assert.deepEqual(rowIds(vm, "archived"), [5, 4]);
        const archived = rowOf(vm, 5, "archived");
        await vm.runAction(archived, archived.primary);
        assert.deepEqual(calls.archived, [[4, true], [5, false]]);
        assert.deepEqual(rowIds(vm, "finished"), [5, 3]);
        assert.equal(vm.tab, "ongoing");
    });

    it("reloads the activities when the server refuses to archive", async () => {
        await quietly(async () => {
            const { vm, calls } = createPage({
                catalog: {
                    setArchived: async () => {
                        throw { status: 409, data: { code: "ACTIVITY_NOT_FINISHED" } };
                    },
                },
            });
            await vm.ready;
            const loadsBefore = calls.loads;
            const row = rowOf(vm, 4, "finished");
            await vm.runAction(row, entryOf(row, "archive"));
            assert.equal(calls.loads, loadsBefore + 1);
            assert.deepEqual(vm.busy, {});
        });
    });

    it("does not reload after another failure", async () => {
        await quietly(async () => {
            const { vm, calls } = createPage({
                catalog: { setArchived: async () => { throw { status: 500 }; } },
            });
            await vm.ready;
            const loadsBefore = calls.loads;
            const row = rowOf(vm, 5, "archived");
            await vm.runAction(row, row.primary);
            assert.equal(calls.loads, loadsBefore);
        });
    });

    it("ignores a disabled entry and a second click while busy", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        const row = rowOf(vm, 2, "ongoing");
        await vm.runAction(row, { ...entryOf(row, "view-case"), disabled: true });
        vm.busy[row.id] = true;
        await vm.runAction(row, row.primary);
        assert.deepEqual(calls.navigated, []);
    });
});

describe("activities page, templates", () => {
    const page = read("activity.index.html");
    const fragments = [
        "activities-filters", "activities-action-notice", "activities-empty-page",
        "activities-ongoing-tab", "activities-finished-tab", "activities-archived-tab",
    ];

    it("uses the page controller and includes one fragment per part", () => {
        assert.match(page, /ng-controller="ActivitiesPageController as ap"/);
        for (const name of fragments) {
            assert.ok(page.includes(`fragments/${name}.template.html`), name);
            assert.ok(existsSync(new URL(`fragments/${name}.template.html`, VIEWS)), name);
        }
    });

    it("links the tabs to the URL", () => {
        assert.ok(page.includes('href="#!/activities"'));
        assert.ok(page.includes('href="#!/activities?tab=finished"'));
        assert.ok(page.includes('href="#!/activities?tab=archived"'));
    });

    it("shares the Terminadas table and the row menu between tabs", () => {
        for (const tab of ["finished", "archived"]) {
            assert.ok(read(`fragments/activities-${tab}-tab.template.html`)
                .includes("fragments/activities-finished-table.template.html"));
        }
        for (const table of ["activities-ongoing-tab", "activities-finished-table"]) {
            assert.ok(read(`fragments/${table}.template.html`)
                .includes("fragments/activities-row-menu.template.html"));
        }
    });
});

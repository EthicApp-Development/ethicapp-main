// The home's activities (#1098, epic #1093): loaded from the catalog, built
// again when it changes and when the language changes, with the designs
// loaded only for a teacher with no activities, and the template that shows
// them in the tables of Actividades. AngularJS services are fakes.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

import { HomeActivitiesController } from "../home-activities.controller.js";

const ASSETS = new URL("../../../../", import.meta.url);
const VIEWS = new URL("static/views/teacher/", ASSETS);
const home = readFileSync(new URL("home.html", VIEWS), "utf8");
const locale = name => JSON.parse(readFileSync(new URL(`locales/${name}.json`, ASSETS), "utf8"));

function activity(sessionId, fields = {}) {
    return {
        sessionId,
        time:     new Date(Date.UTC(2026, 9, 1) + sessionId * 60_000).toISOString(),
        code:     `k${sessionId}`,
        status:   "in_progress",
        archived: false,
        ...fields,
    };
}

function design(id, fields = {}) {
    return { id, userOwned: true, archived: false, valid: true, ...fields };
}

function createHome({ activities = [], designs = [], loadDesigns, language = "es_CL" } = {}) {
    const calls = { designLoads: 0, applies: 0, actionOptions: null };
    const listeners = {};
    const scopeListeners = {};
    const rootListeners = {};
    const translate = { language };

    const catalog = {
        activities:    [],
        getActivities: () => catalog.activities,
        async loadActivities() {
            // The request answers later, and the catalog notifies its
            // listeners either way.
            await Promise.resolve();
            catalog.activities = activities;
            catalog.notify();
            return catalog.activities;
        },
        notify() {
            for (const listener of listeners.onActivityCatalogUpdated || []) {
                listener();
            }
        },
        registerListener(event, listener) {
            (listeners[event] ||= []).push(listener);
        },
        unregisterListener(event, listener) {
            listeners[event] = listeners[event].filter(item => item !== listener);
        },
    };
    const $scope = {
        $applyAsync(callback) {
            calls.applies += 1;
            callback?.();
        },
        $on: (event, listener) => {
            scopeListeners[event] = listener;
        },
    };
    const $rootScope = {
        $on(event, listener) {
            (rootListeners[event] ||= []).push(listener);
            return () => {
                rootListeners[event] = rootListeners[event].filter(item => item !== listener);
            };
        },
    };
    const $translate = { use: () => translate.language };
    const DesignCatalogService = {
        loadDesigns: loadDesigns || (async () => {
            calls.designLoads += 1;
            return true;
        }),
        getDesigns: async () => designs,
    };
    const actions = { busy: {}, notice: null, run() {}, copyCode() {} };
    const ActivityRowActionsService = {
        create(scope, options) {
            calls.actionOptions = options;
            calls.actionScope = scope;
            return actions;
        },
    };

    const vm = {};
    HomeActivitiesController.call(vm, $scope, $rootScope, $translate, catalog,
        DesignCatalogService, ActivityRowActionsService);
    return { vm, calls, catalog, listeners, scopeListeners, rootListeners, translate, actions };
}

const ids = rows => rows.map(row => row.id);

// 7 in progress or not started, 4 finished and 1 archived.
const MANY = [
    ...[1, 2, 3, 4, 5, 6, 7].map(id => activity(id)),
    ...[8, 9, 10, 11].map(id => activity(id, { status: "finished" })),
    activity(12, { status: "finished", archived: true }),
];

describe("HomeActivitiesController, loading", () => {
    it("shows the newest rows of each section once the catalog loads", async () => {
        const { vm } = createHome({ activities: MANY });
        assert.equal(vm.loaded, false);
        assert.equal(vm.sections.hasNoActivities, true, "nothing is known yet");

        await vm.ready;

        assert.equal(vm.loaded, true);
        assert.deepEqual(ids(vm.sections.ongoing.rows), [7, 6, 5, 4, 3]);
        assert.deepEqual(ids(vm.sections.finished.rows), [11, 10, 9]);
        assert.equal(vm.sections.ongoing.total, 7);
        assert.equal(vm.sections.finished.total, 4);
        assert.deepEqual(vm.limits, { ongoing: 5, finished: 3 });
    });

    it("keeps the same rows between digests until the catalog changes", async () => {
        const { vm } = createHome({ activities: MANY });
        await vm.ready;
        const { rows } = vm.sections.ongoing;
        assert.equal(vm.sections.ongoing.rows, rows);
    });

    it("does not ask for designs when the teacher has activities", async () => {
        const { vm, calls } = createHome({ activities: MANY });
        await vm.ready;
        assert.equal(calls.designLoads, 0);
    });

    it("counts a teacher whose only activities are archived as having activities", async () => {
        const { vm, calls } = createHome({
            activities: [activity(1, { status: "finished", archived: true })],
        });
        await vm.ready;
        assert.equal(vm.sections.hasNoActivities, false);
        assert.equal(vm.sections.ongoing.total, 0);
        assert.equal(vm.sections.finished.total, 0);
        assert.equal(calls.designLoads, 0);
    });

    it("loads the designs for a teacher with no activities, and hides step 1 "
        + "when one is ready", async () => {
        const { vm, calls } = createHome({ designs: [design(1)] });
        await vm.ready;
        assert.equal(vm.sections.hasNoActivities, true);
        assert.equal(calls.designLoads, 1);
        assert.equal(vm.showDesignStep, false);
    });

    it("keeps step 1 for a teacher with no activities and no ready design", async () => {
        const { vm } = createHome({ designs: [design(1, { valid: false })] });
        await vm.ready;
        assert.equal(vm.showDesignStep, true);
    });

    it("shows the page once the designs are known, so the empty page does not flicker",
        async () => {
            let resolveDesigns;
            const { vm } = createHome({
                designs:     [design(2)],
                loadDesigns: () => new Promise((resolve) => {
                    resolveDesigns = resolve;
                }),
            });
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(vm.loaded, false);
            resolveDesigns(true);
            await vm.ready;
            assert.equal(vm.loaded, true);
            assert.equal(vm.showDesignStep, false);
        });
});

describe("HomeActivitiesController, rebuilding", () => {
    it("builds the sections again when the catalog changes, as after an archive", async () => {
        const { vm, catalog } = createHome({ activities: MANY });
        await vm.ready;
        const before = vm.sections.finished.rows;

        // Archiving the newest finished activity: the next one takes its row.
        catalog.activities = MANY.map(item => (item.sessionId === 11
            ? { ...item, archived: true }
            : item));
        catalog.notify();

        assert.notEqual(vm.sections.finished.rows, before);
        assert.deepEqual(ids(vm.sections.finished.rows), [10, 9, 8]);
        assert.equal(vm.sections.finished.total, 3);
    });

    it("builds the sections again in the new language", async () => {
        const { vm, rootListeners, translate } = createHome({
            activities: [activity(1, { time: "2026-01-12T15:00:00Z" })],
        });
        await vm.ready;
        const spanish = vm.sections.ongoing.rows[0].launched.label.text;

        translate.language = "en_US";
        for (const listener of rootListeners.$translateChangeSuccess) {
            listener();
        }

        const english = vm.sections.ongoing.rows[0].launched.label.text;
        assert.match(spanish, /ene/u);
        assert.match(english, /Jan/u);
    });

    it("stops listening to the catalog and the language when the home goes away", async () => {
        const { vm, listeners, scopeListeners, rootListeners } = createHome({ activities: MANY });
        await vm.ready;
        assert.equal(listeners.onActivityCatalogUpdated.length, 1);
        assert.equal(rootListeners.$translateChangeSuccess.length, 1);

        scopeListeners.$destroy();

        assert.deepEqual(listeners.onActivityCatalogUpdated, []);
        assert.deepEqual(rootListeners.$translateChangeSuccess, []);
    });
});

describe("HomeActivitiesController, row actions and links", () => {
    it("uses its own row actions instance, outside the tabs of Actividades", async () => {
        const { vm, calls, actions } = createHome();
        await vm.ready;
        assert.equal(vm.actions, actions);
        assert.equal(calls.actionOptions.currentTab(), "finished");
        // The default opens the Activities page on the tab.
        assert.equal(calls.actionOptions.showTab, undefined);
    });

    it("links to Actividades with the URL helpers' values", () => {
        const { vm } = createHome();
        assert.deepEqual(vm.links, {
            ongoing:    "#!/activities",
            notStarted: "#!/activities?status=not-started",
            finished:   "#!/activities?tab=finished",
        });
    });
});

describe("home template", () => {
    it("is the home activities controller, and no longer the recent activities cards", () => {
        assert.ok(home.includes('ng-controller="HomeActivitiesController as ha"'));
        assert.doesNotMatch(home, /activity-description/u);
        assert.doesNotMatch(home, /\bra\./u);
        assert.doesNotMatch(home, /RecentActivitiesController/u);
    });

    it("keeps the launcher panel, which the home column's rule needs", () => {
        assert.ok(home.includes('class="panel panel-default teacher-workbench-panel"'));
    });

    it("shows each section in the activities table, bound to the rows of one build", () => {
        for (const tab of ["ongoing", "finished"]) {
            assert.ok(home.includes(`tab="${tab}"`), tab);
            assert.ok(home.includes(`rows="ha.sections.${tab}.rows"`), tab);
            assert.ok(home.includes(`limit="ha.limits.${tab}"`), tab);
        }
        assert.equal(home.match(/<activities-table/gu).length, 2);
        assert.equal(home.match(/busy="ha\.actions\.busy"/gu).length, 2);
        assert.equal(home.match(/on-action="ha\.actions\.run\(row, action\)"/gu).length, 2);
        assert.equal(home.match(/on-copy-code="ha\.actions\.copyCode\(row\)"/gu).length, 2);
        assert.ok(home.includes('<activity-action-notice actions="ha.actions">'));
    });

    it("links the counts and the footers to Actividades", () => {
        assert.equal(home.match(/ng-href="\{\{ ha\.links\.ongoing \}\}"/gu).length, 2);
        assert.equal(home.match(/ng-href="\{\{ ha\.links\.notStarted \}\}"/gu).length, 1);
        assert.equal(home.match(/ng-href="\{\{ ha\.links\.finished \}\}"/gu).length, 2);
        assert.ok(home.includes('href="#!/activities/new"'));
        // The arrow is decoration.
        assert.equal(home.match(/<span aria-hidden="true">&rarr;<\/span>/gu).length, 2);
    });

    it("shows the empty page, the one line, and the finished section by the totals", () => {
        assert.ok(home.includes('ng-if="ha.loaded && ha.sections.hasNoActivities"'));
        assert.ok(home.includes('ng-if="ha.loaded && !ha.sections.hasNoActivities'
            + ' && ha.sections.ongoing.total === 0"'));
        assert.ok(home.includes('ng-if="ha.loaded && ha.sections.finished.total > 0"'));
        assert.ok(home.includes("'activities_empty_ongoing' | translate"));
    });

    it("translates every text in both locales", () => {
        const keys = [...home.matchAll(/'([a-z_]+)'\s*\|\s*translate/gu)].map(match => match[1]);
        const captions = [...home.matchAll(/caption="([a-z_]+)"/gu)].map(match => match[1]);
        assert.ok(keys.length >= 10);
        assert.equal(captions.length, 2);
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            for (const key of [...keys, ...captions]) {
                assert.equal(typeof catalog[key], "string", `${name}: ${key}`);
            }
        }
    });

    it("retires the old panel's keys, and keeps the launcher's", () => {
        const retired = [
            "recent_activities_title_text", "no_recent_activities_text",
            "ethical_cases_create", "create_design",
        ];
        for (const name of ["es_CL", "en_US"]) {
            for (const key of retired) {
                assert.equal(locale(name)[key], undefined, `${name}: ${key}`);
            }
            assert.equal(typeof locale(name).launch_activity, "string");
        }
        const sources = [];
        const walk = (url) => {
            for (const entry of readdirSync(url)) {
                const child = new URL(entry, url);
                if (statSync(child).isDirectory()) {
                    if (entry !== "dist" && entry !== "__tests__") {
                        walk(new URL(`${entry}/`, url));
                    }
                } else if (/\.(html|js|mjs)$/u.test(entry)) {
                    sources.push(readFileSync(child, "utf8"));
                }
            }
        };
        walk(new URL("js/", ASSETS));
        walk(VIEWS);
        for (const key of retired) {
            const used = new RegExp(`['"]${key}['"]`, "u");
            assert.ok(sources.every(source => !used.test(source)), key);
        }
    });
});

// The Activities page of a teacher with no activities (#1053, epic #1046):
// the empty page replaces "En curso", loads the teacher's designs only then,
// and leaves out "Prepara un diseño" when a design is ready to launch, by the
// launch wizard's rule. AngularJS services are fakes.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

import { ActivitiesPageController } from "../activities-page.controller.js";

const ASSETS = new URL("../../../../", import.meta.url);
const VIEWS = new URL("static/views/teacher/", ASSETS);
const read = path => readFileSync(new URL(path, VIEWS), "utf8");
const locale = name => JSON.parse(readFileSync(new URL(`locales/${name}.json`, ASSETS), "utf8"));

function design(id, fields = {}) {
    return { id, userOwned: true, archived: false, valid: true, ...fields };
}

function createPage({ activities = [], designs = [], loadDesigns } = {}) {
    const calls = { designLoads: 0 };
    const $scope = { $on() {}, $applyAsync(fn) { fn?.(); }, navigateTo() {} };
    const $rootScope = { $on: () => () => {} };
    const $location = { search: () => ({}) };
    const $translate = { use: () => "es_CL" };
    const ActivityCatalogService = {
        getActivities:  () => activities,
        loadActivities: async () => activities,
        registerListener() {},
        unregisterListener() {},
    };
    const DesignCatalogService = {
        loadDesigns: loadDesigns || (async () => {
            calls.designLoads += 1;
            return true;
        }),
        getDesigns: async () => designs,
    };

    // The row actions (#1094), which these tests do not use.
    const ActivityRowActionsService = { create: () => ({ busy: {}, notice: null }) };

    const vm = {};
    ActivitiesPageController.call(vm, $scope, $rootScope, $location, $translate,
        ActivityCatalogService, DesignCatalogService, ActivityRowActionsService);
    return { vm, calls };
}

function quietly(run) {
    const { error } = console;
    console.error = () => {};
    return Promise.resolve(run()).finally(() => {
        console.error = error;
    });
}

describe("activities page, a teacher with no activities", () => {
    it("shows both steps when the teacher has no designs", async () => {
        const { vm, calls } = createPage();
        await vm.ready;
        assert.equal(vm.hasNoActivities(), true);
        assert.equal(vm.showDesignStep, true);
        assert.equal(calls.designLoads, 1);
    });

    it("leaves out the design step when a design is ready to launch", async () => {
        const { vm } = createPage({ designs: [design(1, { valid: false }), design(2)] });
        await vm.ready;
        assert.equal(vm.showDesignStep, false);
    });

    it("counts a locked design as ready, as the launch wizard lists it", async () => {
        const { vm } = createPage({ designs: [design(1, { locked: true })] });
        await vm.ready;
        assert.equal(vm.showDesignStep, false);
    });

    it("keeps the design step when the only designs have errors, are archived "
        + "or are other teachers'", async () => {
        const { vm } = createPage({
            designs: [
                design(1, { valid: false }),
                design(2, { archived: true }),
                design(3, { userOwned: false, visibility: "public" }),
            ],
        });
        await vm.ready;
        assert.equal(vm.showDesignStep, true);
    });

    it("keeps the design step when the designs cannot be loaded", async () => {
        // The catalog still holds a ready design from an earlier load.
        const { vm } = createPage({ designs: [design(2)], loadDesigns: async () => false });
        await vm.ready;
        assert.equal(vm.showDesignStep, true);
    });

    it("keeps the design step when the designs request rejects", async () => {
        const { vm } = createPage({
            designs:     [design(2)],
            loadDesigns: async () => {
                throw new Error("network");
            },
        });
        await quietly(() => vm.ready);
        assert.equal(vm.loaded, true);
        assert.equal(vm.showDesignStep, true);
    });

    it("shows the page once the designs are known, so step 1 does not flicker", async () => {
        let resolveDesigns;
        const { vm } = createPage({
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

    it("does not ask for designs when the teacher has activities", async () => {
        const { vm, calls } = createPage({
            activities: [{
                sessionId:   1,
                time:        "2026-10-20T12:00:00Z",
                code:        "k1",
                archived:    true,
                status:      "finished",
                designTitle: "A",
            }],
        });
        await vm.ready;
        assert.equal(vm.hasNoActivities(), false);
        assert.equal(calls.designLoads, 0);
    });
});

describe("activities page, the empty page's templates", () => {
    const fragment = read("fragments/activities-empty-page.template.html");
    const page = read("activity.index.html");

    it("replaces En curso only, and keeps the other tabs' one-line messages", () => {
        assert.match(page, /ap\.tab === 'ongoing' && ap\.hasNoActivities\(\)/u);
        assert.match(read("fragments/activities-finished-tab.template.html"),
            /ng-if="ap\.count\('finished'\) === 0"[\s\S]*activities_empty_finished/u);
        assert.match(read("fragments/activities-archived-tab.template.html"),
            /ng-if="ap\.count\('archived'\) === 0"[\s\S]*activities_empty_archived/u);
    });

    it("links each step to its page, and hides step 1 and the numbers with it", () => {
        assert.ok(fragment.includes('href="#!/designs/new"'));
        assert.ok(fragment.includes('href="#!/activities/new"'));
        assert.ok(fragment.includes('class="fa fa-rocket"'));
        assert.equal(fragment.match(/ng-if="ap\.showDesignStep"/gu).length, 2);
    });

    it("translates every text in both locales", () => {
        const keys = [...fragment.matchAll(/'([a-z_]+)' \| translate/gu)].map(match => match[1]);
        assert.ok(keys.length >= 7);
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", `${name}: ${key}`);
            }
        }
        assert.equal(locale("es_CL").activities_empty_page_intro,
            "Una actividad es un diseño que lanzas con un grupo de participantes. "
            + "Se unen con un código.");
        assert.match(locale("en_US").activities_empty_page_intro, /participants/u);
    });

    it("retires the old one-sentence alert's keys", () => {
        const retired = [
            "empty_ongoing_activities_message", "empty_activities_create_design_link",
            "empty_activities_then_launch_message", "empty_activities_launch_link",
        ];
        for (const name of ["es_CL", "en_US"]) {
            for (const key of retired) {
                assert.equal(locale(name)[key], undefined, `${name}: ${key}`);
            }
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
            assert.ok(sources.every(source => !source.includes(key)), key);
        }
    });
});

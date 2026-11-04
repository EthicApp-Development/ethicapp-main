// The home's recent activities (#1055): loaded from the catalog, rebuilt when
// it changes, and opened on the activity's dashboard.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { RecentActivitiesController } from "../recent-activities.controller.js";

const home = readFileSync(new URL(
    "../../../../static/views/teacher/home.html", import.meta.url), "utf8");

function createHome(activities) {
    const listeners = {};
    const scopeListeners = {};
    const navigations = [];
    const catalog = {
        activities:    [],
        getActivities: () => catalog.activities,
        async loadActivities() {
            // The request answers later.
            await Promise.resolve();
            catalog.activities = activities;
            for (const listener of listeners.onActivityCatalogUpdated || []) {
                listener();
            }
            return catalog.activities;
        },
        registerListener(event, listener) {
            (listeners[event] ||= []).push(listener);
        },
        unregisterListener(event, listener) {
            listeners[event] = listeners[event].filter(item => item !== listener);
        },
    };
    const $scope = {
        $applyAsync: callback => callback(),
        $on:         (event, listener) => {
            scopeListeners[event] = listener;
        },
        navigateTo: path => navigations.push(path),
    };
    const vm = new RecentActivitiesController($scope, catalog);
    return { vm, listeners, scopeListeners, navigations };
}

describe("RecentActivitiesController", () => {
    it("shows the newest activities once the catalog loads", async () => {
        const { vm } = createHome([
            { sessionId: 1, time: "2026-10-01T12:00:00Z", status: "in_progress", archived: false },
            { sessionId: 2, time: "2026-10-02T12:00:00Z", status: "finished", archived: false },
            { sessionId: 3, time: "2026-10-03T12:00:00Z", status: "finished", archived: true },
        ]);
        assert.equal(vm.isEmpty(), true, "empty before the catalog loads");

        await vm.ready;

        assert.deepEqual(vm.activities.ongoing.map(item => item.sessionId), [1]);
        assert.deepEqual(vm.activities.finished.map(item => item.sessionId), [2]);
        assert.equal(vm.isEmpty(), false);
    });

    it("is empty for a teacher with only archived activities", async () => {
        const { vm } = createHome([{ sessionId: 3, status: "finished", archived: true }]);
        await vm.ready;
        assert.equal(vm.isEmpty(), true);
    });

    it("opens the activity's dashboard", () => {
        const { vm, navigations } = createHome([]);
        vm.handleView({ sessionId: 42 });
        assert.deepEqual(navigations, ["/activities/42"]);
    });

    it("stops listening to the catalog when the home goes away", async () => {
        const { vm, listeners, scopeListeners } = createHome([]);
        await vm.ready;
        scopeListeners.$destroy();
        assert.deepEqual(listeners.onActivityCatalogUpdated, []);
    });

    it("is the home's recent activities controller", () => {
        assert.match(home, /ng-controller="RecentActivitiesController as ra"/);
        assert.doesNotMatch(home, /ActivityController|limitTo/);
    });
});

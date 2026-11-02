// The dashboard's browser tab title (#973, epic #965): the activity's name
// and description while the dashboard is open, the page's own title again
// once it goes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DashboardController } from "../dashboard.controller.js";

const DESCRIPTOR = {
    name:         "Privacidad en apps de salud",
    description:  "Sección 3 · 2026-2",
    designId:     7,
    status:       "in_progress",
    currentPhase: null,
    phases:       [],
};

// A dashboard for session 12, whose activity state loads when `load()` is
// called.
function createDashboard() {
    const destroyHandlers = [];
    const $scope = {
        navigateTo() {},
        $on(name, handler) {
            if (name === "$destroy") {
                destroyHandlers.push(handler);
            }
        },
        $applyAsync: fn => fn(),
    };
    let resolveState;
    const stateLoaded = new Promise(resolve => {
        resolveState = resolve;
    });
    const ActivityStateService = {
        subscribeToActivityEvents: () => () => {},
        registerListener() {},
        unregisterListener() {},
        loadActivityState: () => stateLoaded,
        getInstancedPhases: async () => [],
    };
    const $window = { innerWidth: 1366, document: { title: "EthicApp" } };
    const vm = {};
    DashboardController.call(vm, $scope, { id: "12" }, null,
        async key => key, null,
        ActivityStateService,
        { takeLaunchNotice: () => [] },
        { getDesignById: async () => ({ id: 7, phases: [] }) },
        { getCaseByDesignId: async () => null }, null, $window);

    return {
        vm,
        doc: $window.document,
        async load() {
            resolveState({ descriptor: DESCRIPTOR, users: [] });
            // Let the dashboard's own initialization run to its end.
            await new Promise(resolve => setImmediate(resolve));
        },
        destroy: () => destroyHandlers.forEach(handler => handler()),
    };
}

describe("DashboardController browser tab title", () => {
    it("shows the activity's name and description once the activity loads", async () => {
        const dashboard = createDashboard();
        assert.equal(dashboard.doc.title, "EthicApp", "unchanged while the activity loads");

        await dashboard.load();
        assert.equal(dashboard.doc.title, "Privacidad en apps de salud · Sección 3 · 2026-2 – EthicApp");
    });

    it("puts the page's title back when the dashboard goes", async () => {
        const dashboard = createDashboard();
        await dashboard.load();

        dashboard.destroy();
        assert.equal(dashboard.doc.title, "EthicApp");
    });

    it("leaves the next page's title alone when the activity loads after the dashboard went", async () => {
        const dashboard = createDashboard();
        dashboard.destroy();
        dashboard.doc.title = "Next page";

        await dashboard.load();
        assert.equal(dashboard.doc.title, "Next page");
    });
});

// The dashboard controller's one-column layout (#895, epic #892): it starts
// in the layout the window's width calls for, switches when the window
// crosses 1200 px, keeps the selected phase and tab, stops watching when the
// view goes, and gives the response tables the questions' text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DashboardController } from "../dashboard.controller.js";
import { fakeMediaWindow } from "../../../helpers/__tests__/fake-windows.mjs";

// A dashboard without its init (the route has no id), in `$window`.
function createDashboard($window) {
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
    const vm = {};
    DashboardController.call(vm, $scope, {}, null, null, null, null, {},
        { takeLaunchNotice: () => [] }, null, null, null, null, $window);
    return { vm, destroy: () => destroyHandlers.forEach(handler => handler()) };
}

describe("DashboardController layout", () => {
    it("starts in one column below 1200 px, the sections collapsed", () => {
        const { vm } = createDashboard(fakeMediaWindow(1024));
        assert.equal(vm.isOneColumn, true);
        assert.equal(vm.phaseSectionOpen, false);
        assert.equal(vm.servicesSectionOpen, false);
        assert.equal(vm.activityCardExpanded, false);
    });

    it("starts in two columns from 1200 px", () => {
        assert.equal(createDashboard(fakeMediaWindow(1366)).vm.isOneColumn, false);
        assert.equal(createDashboard({ innerWidth: 1920 }).vm.isOneColumn, false);
    });

    it("switches layouts across 1200 px and keeps the selected phase, tab and search", () => {
        const win = fakeMediaWindow(1366);
        const { vm } = createDashboard(win);
        vm.dashboardPhaseData = [
            { descriptor: { id: 40, number: 1 } },
            { descriptor: { id: 41, number: 2 } },
        ];
        vm.selectPhaseById(40);
        vm.selectMainTab("design");
        vm.participantQuery = "ana";

        win.resize(1024);
        assert.equal(vm.isOneColumn, true);
        win.resize(1440);
        assert.equal(vm.isOneColumn, false);

        assert.equal(vm.selectedPhaseId, 40);
        assert.equal(vm.mainTab, "design");
        assert.equal(vm.participantQuery, "ana");
    });

    it("keeps the sections open or closed across a switch", () => {
        const win = fakeMediaWindow(1024);
        const { vm } = createDashboard(win);
        vm.togglePhaseSection();
        vm.toggleServicesSection();
        vm.toggleServicesSection();

        win.resize(1600);
        win.resize(1000);
        assert.equal(vm.phaseSectionOpen, true);
        assert.equal(vm.servicesSectionOpen, false);
    });

    it("stops watching the window when the view goes", () => {
        const win = fakeMediaWindow(1366);
        const { destroy } = createDashboard(win);
        assert.equal(win.listeners.size, 1);
        destroy();
        assert.equal(win.listeners.size, 0);
    });

    it("gives each phase's table the same question texts on every digest", () => {
        const { vm } = createDashboard({ innerWidth: 1024 });
        vm.designObj = {
            phases: [
                { number: 1, questions: [{ q_text: "Primera" }, { q_text: "Segunda" }] },
                { number: 2, roles: [] },
            ],
        };

        const texts = vm.questionTexts({ number: 1 });
        assert.deepEqual(texts, ["Primera", "Segunda"]);
        assert.equal(vm.questionTexts({ number: 1 }), texts);
        assert.deepEqual(vm.questionTexts({ number: 2 }), []);
        assert.equal(vm.questionTexts({ number: 3 }), null);
    });

    it("counts the selected phase's AI services for the collapsed section", () => {
        const { vm } = createDashboard({ innerWidth: 1024 });
        vm.designObj = {
            phases: [
                {
                    number:           1,
                    externalServices: { enabledServiceIds: ["ats-feedback", "discussion-agent"] },
                },
                { number: 2 },
            ],
        };
        vm.dashboardPhaseData = [
            { descriptor: { id: 40, number: 1 } },
            { descriptor: { id: 41, number: 2 } },
        ];

        vm.selectPhaseById(40);
        assert.equal(vm.selectedPhaseServiceCount(), 2);
        assert.equal(vm.selectedPhaseHasServices(), true);

        vm.selectPhaseById(41);
        assert.equal(vm.selectedPhaseServiceCount(), 0);
        assert.equal(vm.selectedPhaseHasServices(), false);
    });
});

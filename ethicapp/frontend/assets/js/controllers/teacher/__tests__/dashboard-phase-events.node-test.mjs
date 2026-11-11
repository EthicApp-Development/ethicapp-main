// The dashboard follows phases it did not start (#1116, epic #1105): it
// moves to the new phase as for its own start, shows a toast only for an
// advance by the deadline, rebuilds after a reconnect, and invites the
// teacher to finish the activity when the last phase's time runs out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DashboardController } from "../dashboard.controller.js";

const SESSION_ID = 12;
const LOCAL_NOW = Date.parse("2026-11-11T12:00:00.000Z");
const ENDS_AT = "2026-11-11T12:00:00.000Z";

function lastPhaseClock(overrides = {}) {
    return {
        sessionId:   SESSION_ID,
        timeMode:    "hard",
        finished:    false,
        phaseId:     43,
        phaseNumber: 3,
        startedAt:   "2026-11-11T11:50:00.000Z",
        endsAt:      ENDS_AT,
        isLastPhase: true,
        serverNow:   "2026-11-11T11:59:50.000Z",
        offsetMs:    0,
        receivedAt:  LOCAL_NOW - 10000,
        ...overrides,
    };
}

// A dashboard for session 12, at phase 2 of 3, initialized with fakes.
async function createDashboard({ localNow = LOCAL_NOW } = {}) {
    const listeners = {};
    const destroyHandlers = [];
    const scopeHandlers = {};
    const state = {
        descriptor: {
            designId:     7,
            status:       "in_progress",
            currentPhase: { id: 41, number: 2 },
            phases:       [{ id: 40, number: 1 }, { id: 41, number: 2 }],
        },
        users: [{ id: 1, name: "Ana", role: "A" }],
    };
    const clock = { current: null };
    const $scope = {
        navigateTo() {},
        $on(name, handler) {
            if (name === "$destroy") {
                destroyHandlers.push(handler);
            }
            (scopeHandlers[name] ||= []).push(handler);
        },
        $applyAsync: fn => fn(),
    };
    const ActivityStateService = {
        subscribeToActivityEvents: () => () => {},
        registerListener(name, callback) {
            (listeners[name] ||= []).push(callback);
        },
        unregisterListener(name, callback) {
            listeners[name] = (listeners[name] || []).filter(existing => existing !== callback);
        },
        loadActivityState: async () => state,
        getInstancedPhases: async () => [],
        getPhaseClock: () => clock.current,
    };
    const toasts = [];
    const toast = { create: options => toasts.push(options) };
    const $translate = Object.assign(async key => key, {
        instant: (key, params) => `${key}${params ? JSON.stringify(params) : ""}`,
    });
    const finishRequests = [];
    const $http = {
        post: async (url) => {
            finishRequests.push(url);
            return { data: {} };
        },
    };
    const vm = {};
    DashboardController.call(vm, $scope, { id: String(SESSION_ID) }, $http,
        $translate, fn => fn(),
        ActivityStateService,
        { takeLaunchNotice: () => [] },
        { getDesignById: async () => ({ id: 7, type: "semantic_differential", phases: [{}, {}, {}] }) },
        { getCaseByDesignId: async () => null }, null,
        { innerWidth: 1920, document: { title: "EthicApp" } },
        toast, () => localNow);
    await new Promise(resolve => setImmediate(resolve));

    const updated = [];
    vm.updateDashboardPhaseData = async phaseId => updated.push(phaseId);
    vm.dashboardPhaseData = [
        { descriptor: { id: 40, number: 1 }, state: [] },
        { descriptor: { id: 41, number: 2 }, state: [] },
    ];
    const advanced = [];
    vm.activatePhaseTabById = phaseId => advanced.push(phaseId);

    return {
        vm,
        state,
        clock,
        toasts,
        finishRequests,
        updated,
        advanced,
        notify: (name, data) => Promise.all((listeners[name] || []).map(callback => callback(data))),
        listenerCount: name => (listeners[name] || []).length,
        destroy: () => destroyHandlers.forEach(handler => handler()),
    };
}

// The service read the phases again and the activity is at phase 3.
function moveToLastPhase(dashboard) {
    dashboard.state.descriptor = {
        ...dashboard.state.descriptor,
        currentPhase: { id: 43, number: 3 },
        phases:       [...dashboard.state.descriptor.phases, { id: 43, number: 3 }],
    };
}

describe("DashboardController phase transitions", () => {
    it("moves to a phase started by the deadline, closes the detail and shows a toast", async () => {
        const dashboard = await createDashboard();
        dashboard.vm.detail = { key: "group:7", phaseId: 41 };
        moveToLastPhase(dashboard);

        await dashboard.notify("onPhaseTransition",
            { sessionId: SESSION_ID, phaseId: 43, phaseNumber: 3, reason: "deadline" });

        assert.deepEqual(dashboard.updated, [43]);
        assert.deepEqual(dashboard.advanced, [43]);
        assert.equal(dashboard.vm.detail, null);
        assert.equal(dashboard.vm.reachedLastPhase, true, "the next-phase button goes away");
        assert.equal(dashboard.toasts.length, 1);
        assert.equal(dashboard.toasts[0].message,
            "dashboard_phase_deadline_advanced_toast{\"number\":3}");
        assert.equal(dashboard.toasts[0].containerClass, "activity-dashboard-toast-container");
        assert.equal(dashboard.toasts[0].dismissible, true);
    });

    it("moves to a phase a teacher started in another tab, without a toast", async () => {
        const dashboard = await createDashboard();
        moveToLastPhase(dashboard);

        await dashboard.notify("onPhaseTransition",
            { sessionId: SESSION_ID, phaseId: 43, phaseNumber: 3, reason: "teacher" });

        assert.deepEqual(dashboard.advanced, [43]);
        assert.deepEqual(dashboard.toasts, []);
    });

    it("moves without a toast to a phase found after a reconnect", async () => {
        const dashboard = await createDashboard();
        moveToLastPhase(dashboard);

        await dashboard.notify("onPhaseTransition",
            { sessionId: SESSION_ID, phaseId: 43, phaseNumber: 3, reason: null });

        assert.deepEqual(dashboard.advanced, [43]);
        assert.deepEqual(dashboard.toasts, []);
    });

    it("ignores another activity's transition", async () => {
        const dashboard = await createDashboard();

        await dashboard.notify("onPhaseTransition",
            { sessionId: 99, phaseId: 90, phaseNumber: 3, reason: "deadline" });

        assert.deepEqual(dashboard.updated, []);
        assert.deepEqual(dashboard.toasts, []);
    });

    it("stops listening when it goes", async () => {
        const dashboard = await createDashboard();
        ["onPhaseTransition", "onPhaseClock", "onPhaseDeadlineReached", "onActivityResynced"]
            .forEach(name => assert.equal(dashboard.listenerCount(name), 1, name));

        dashboard.destroy();
        ["onPhaseTransition", "onPhaseClock", "onPhaseDeadlineReached", "onActivityResynced"]
            .forEach(name => assert.equal(dashboard.listenerCount(name), 0, name));
    });
});

describe("DashboardController after a reconnect", () => {
    it("rebuilds the participants and every phase shown", async () => {
        const dashboard = await createDashboard();
        dashboard.state.users = [{ id: 1 }, { id: 2 }];

        await dashboard.notify("onActivityResynced", { sessionId: SESSION_ID });

        assert.deepEqual(dashboard.vm.userList, [{ id: 1 }, { id: 2 }]);
        assert.deepEqual(dashboard.updated, [40, 41]);
    });

    it("ignores another activity's resync", async () => {
        const dashboard = await createDashboard();
        await dashboard.notify("onActivityResynced", { sessionId: 99 });
        assert.deepEqual(dashboard.updated, []);
    });
});

describe("DashboardController last phase deadline notice", () => {
    it("shows when the server reports the last phase's deadline, and the activity stays open", async () => {
        const dashboard = await createDashboard({ localNow: LOCAL_NOW - 2000 });
        moveToLastPhase(dashboard);
        dashboard.clock.current = lastPhaseClock();
        await dashboard.notify("onPhaseClock", dashboard.clock.current);
        assert.equal(dashboard.vm.lastPhaseDeadlineNotice, null, "before 00:00");

        await dashboard.notify("onPhaseDeadlineReached",
            { sessionId: SESSION_ID, phaseId: 43, isLastPhase: true });

        assert.deepEqual(dashboard.vm.lastPhaseDeadlineNotice,
            { key: `43|${ENDS_AT}`, phaseId: 43, endsAt: ENDS_AT });
        assert.equal(dashboard.vm.isActivityFinished, false);
    });

    it("shows on a dashboard opened after the deadline passed", async () => {
        const dashboard = await createDashboard({ localNow: LOCAL_NOW + 30000 });
        dashboard.clock.current = lastPhaseClock();

        await dashboard.notify("onPhaseClock", dashboard.clock.current);

        assert.equal(dashboard.vm.lastPhaseDeadlineNotice.phaseId, 43);
    });

    it("ignores another activity's deadline and one that is not the last phase's", async () => {
        const dashboard = await createDashboard({ localNow: LOCAL_NOW - 2000 });
        dashboard.clock.current = lastPhaseClock();

        await dashboard.notify("onPhaseDeadlineReached",
            { sessionId: 99, phaseId: 43, isLastPhase: true });
        await dashboard.notify("onPhaseDeadlineReached",
            { sessionId: SESSION_ID, phaseId: 43, isLastPhase: false });

        assert.equal(dashboard.vm.lastPhaseDeadlineNotice, null);
    });

    it("goes away with \"+1 min\", and stays closed once dismissed", async () => {
        const dashboard = await createDashboard({ localNow: LOCAL_NOW + 1000 });
        dashboard.clock.current = lastPhaseClock();
        await dashboard.notify("onPhaseClock", dashboard.clock.current);
        assert.notEqual(dashboard.vm.lastPhaseDeadlineNotice, null);

        dashboard.clock.current = lastPhaseClock({ endsAt: "2026-11-11T12:01:00.000Z" });
        await dashboard.notify("onPhaseClock", dashboard.clock.current);
        assert.equal(dashboard.vm.lastPhaseDeadlineNotice, null);

        dashboard.clock.current = lastPhaseClock();
        await dashboard.notify("onPhaseClock", dashboard.clock.current);
        dashboard.vm.dismissLastPhaseDeadlineNotice();
        assert.equal(dashboard.vm.lastPhaseDeadlineNotice, null);
        await dashboard.notify("onPhaseClock", dashboard.clock.current);
        assert.equal(dashboard.vm.lastPhaseDeadlineNotice, null);
    });

    it("goes away when the teacher finishes the activity", async () => {
        const dashboard = await createDashboard({ localNow: LOCAL_NOW + 1000 });
        dashboard.clock.current = lastPhaseClock();
        await dashboard.notify("onPhaseClock", dashboard.clock.current);
        assert.notEqual(dashboard.vm.lastPhaseDeadlineNotice, null);

        const originalLog = console.log;
        console.log = () => {};
        try {
            dashboard.vm.endActivity();
            assert.equal(dashboard.vm.lastPhaseDeadlineNotice, null);
            await dashboard.notify("onPhaseClock", dashboard.clock.current);
        } finally {
            console.log = originalLog;
        }

        assert.equal(dashboard.vm.lastPhaseDeadlineNotice, null);
        assert.deepEqual(dashboard.finishRequests, [`/activities/${SESSION_ID}/finish`]);
    });
});

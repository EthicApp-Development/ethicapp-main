// Starting the next phase from the dashboard (#906): one request, which
// carries only the phase number the teacher sees, then the state reload.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ActivityStateService } from "../activity-state.service.js";
import { DashboardController } from "../../controllers/teacher/dashboard.controller.js";

const SESSION_ID = 10;

function createService(postOutcome) {
    const requests = [];
    const $http = async (config) => {
        requests.push({ method: config.method, url: config.url });
        return { data: {} };
    };
    $http.post = async (url, data) => {
        requests.push({ method: "POST", url, data });
        return postOutcome();
    };
    $http.get = async (url) => {
        requests.push({ method: "GET", url });
        if (url.endsWith("/descriptor")) {
            return { data: { descriptor: { currentPhase: { id: 77, number: 2 } } } };
        }
        if (url.endsWith("/phases")) {
            return { data: { phases: [{ id: 76, number: 1 }, { id: 77, number: 2 }] } };
        }
        return { data: { phases: [] } };
    };

    const service = ActivityStateService($http, {});
    service.activityStates[SESSION_ID] = { descriptor: { currentPhase: { id: 76, number: 1 } } };
    return { service, requests };
}

const RELOADS = [
    { method: "GET", url: `/activities/${SESSION_ID}/phases` },
    { method: "GET", url: `/activities/${SESSION_ID}/descriptor` },
    { method: "GET", url: `/activities/${SESSION_ID}/responses` },
];

describe("ActivityStateService.startNextPhase", () => {
    it("makes one request with the expected phase number, then reloads the phases", async () => {
        const { service, requests } = createService(async () => ({
            data: { status: "ok", phase: { id: 77, number: 2 } },
        }));

        const phase = await service.startNextPhase(SESSION_ID, 1);

        assert.deepEqual(phase, { id: 77, number: 2 });
        assert.deepEqual(requests, [
            {
                method: "POST",
                url:    `/activities/${SESSION_ID}/phases/next`,
                data:   { expectedPhaseNumber: 1 },
            },
            ...RELOADS,
        ]);
        assert.deepEqual(service.activityStates[SESSION_ID].descriptor.currentPhase,
            { id: 77, number: 2 });
    });

    it("reloads the phases and rethrows when the activity moved on first (409)", async () => {
        const conflict = { status: 409, data: { code: "PHASE_CHANGED", currentPhaseNumber: 2 } };
        const { service, requests } = createService(async () => {
            throw conflict;
        });

        await assert.rejects(service.startNextPhase(SESSION_ID, 1), error => error === conflict);
        assert.deepEqual(requests.slice(1), RELOADS);
        assert.deepEqual(service.activityStates[SESSION_ID].descriptor.currentPhase,
            { id: 77, number: 2 });
    });

    it("rethrows any other failure without reloading", async () => {
        const failure = { status: 500, data: {} };
        const { service, requests } = createService(async () => {
            throw failure;
        });

        await assert.rejects(service.startNextPhase(SESSION_ID, 1), error => error === failure);
        assert.equal(requests.length, 1);
    });
});

describe("DashboardController.startNextPhase", () => {
    // A dashboard for an activity at `currentPhase`, without running its init
    // (the route has no id).
    function createDashboard({ currentPhase, startNextPhase }) {
        const updated = [];
        const activityState = { descriptor: { currentPhase, status: "in_progress" } };
        const ActivityStateService = {
            startNextPhase: async (...args) => startNextPhase(activityState, ...args),
        };
        const $scope = { navigateTo() {}, $on() {}, $applyAsync: fn => fn() };
        const vm = {};
        DashboardController.call(vm, $scope, {}, null, null, null, null, ActivityStateService,
            { takeLaunchNotice: () => [] }, null, null, null, null);
        vm.sessionId = SESSION_ID;
        vm.activityState = activityState;
        vm.designObj = { phases: [{}, {}, {}] };
        vm.updateDashboardPhaseData = async phaseId => updated.push(phaseId);
        return { vm, updated };
    }

    it("asks for the phase after the current one and shows the new phase", async () => {
        const calls = [];
        const { vm, updated } = createDashboard({
            currentPhase:   { id: 76, number: 1 },
            startNextPhase: async (state, sessionId, expectedPhaseNumber) => {
                calls.push([sessionId, expectedPhaseNumber]);
                state.descriptor = { currentPhase: { id: 77, number: 2 }, status: "in_progress" };
                return { id: 77, number: 2 };
            },
        });

        assert.equal(await vm.startNextPhase(), 77);
        assert.deepEqual(calls, [[SESSION_ID, 1]]);
        assert.deepEqual(updated, [77]);
        assert.equal(vm.reachedLastPhase, false);
    });

    it("asks for the first phase with 0", async () => {
        const calls = [];
        const { vm } = createDashboard({
            currentPhase:   null,
            startNextPhase: async (state, sessionId, expectedPhaseNumber) => {
                calls.push(expectedPhaseNumber);
                return { id: 75, number: 1 };
            },
        });

        assert.equal(await vm.startNextPhase(), 75);
        assert.deepEqual(calls, [0]);
    });

    it("shows the phase the activity is at when another tab started it first", async () => {
        const { vm, updated } = createDashboard({
            currentPhase:   { id: 76, number: 1 },
            startNextPhase: async (state) => {
                state.descriptor = { currentPhase: { id: 78, number: 3 }, status: "in_progress" };
                throw { status: 409, data: { code: "PHASE_CHANGED", currentPhaseNumber: 3 } };
            },
        });
        const originalWarn = console.warn;
        console.warn = () => {};

        try {
            assert.equal(await vm.startNextPhase(), 78);
        } finally {
            console.warn = originalWarn;
        }
        assert.deepEqual(updated, [78]);
        assert.equal(vm.reachedLastPhase, true);
    });

    it("resolves to null when the phase could not start", async () => {
        const { vm, updated } = createDashboard({
            currentPhase:   { id: 76, number: 1 },
            startNextPhase: async () => {
                throw { status: 500, data: {} };
            },
        });
        const originalError = console.error;
        console.error = () => {};

        try {
            assert.equal(await vm.startNextPhase(), null);
        } finally {
            console.error = originalError;
        }
        assert.deepEqual(updated, []);
    });
});

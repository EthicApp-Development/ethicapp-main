import assert from "node:assert/strict";
import { describe, it } from "node:test";

import tutorModeWarningsComponent, {
    SERVICE_INSTANTIATED_EVENT,
} from "../tutor-mode-warnings.component.js";

// The controller is the last entry of the component's annotated array.
const TutorModeWarningsController = tutorModeWarningsComponent.controller.at(-1);

function fakeTimeout() {
    const timers = new Set();
    const $timeout = (callback, delay) => {
        const timer = { callback, delay };
        timers.add(timer);
        return timer;
    };
    $timeout.cancel = timer => timers.delete(timer);
    return { $timeout, timers };
}

function fakeActivityState() {
    const listeners = new Map();
    return {
        listeners,
        registerListener(eventName, callback) {
            listeners.set(eventName, [...(listeners.get(eventName) ?? []), callback]);
        },
        unregisterListener(eventName, callback) {
            listeners.set(eventName, (listeners.get(eventName) ?? []).filter(item => item !== callback));
        },
        emit(eventName, data) {
            (listeners.get(eventName) ?? []).forEach(callback => callback(data));
        },
    };
}

function createWarnings(answers) {
    const results = [...answers];
    const calls = [];
    const { $timeout, timers } = fakeTimeout();
    const activityState = fakeActivityState();
    const tutorModes = {
        listTutorModes: async (sessionId) => {
            calls.push(sessionId);
            const next = results.length > 1 ? results.shift() : results[0];
            if (next instanceof Error) {
                throw next;
            }
            return next;
        },
    };
    const vm = new TutorModeWarningsController({ $applyAsync: () => {} }, $timeout, tutorModes, activityState);
    vm.sessionId = 7;
    vm.phaseId = 20;
    return { vm, calls, timers, activityState };
}

const BASIC = { phaseId: 20, questionKey: "p2-q1", questionNumber: 1, tutorMode: "basic", tutorModeReason: "no-inventory" };
const ENHANCED = { phaseId: 20, questionKey: "p2-q2", questionNumber: 2, tutorMode: "enhanced", tutorModeReason: null };

describe("tutorModeWarnings", () => {
    it("warns about the phase's basic-mode sessions", async () => {
        const { vm, calls } = createWarnings([[BASIC, ENHANCED]]);

        await vm.$onInit();

        assert.deepEqual(calls, [7]);
        assert.deepEqual(vm.warnings, [
            { questionKey: "p2-q1", questionNumber: 1, reasonKey: "tutor_mode_reason_no_inventory" },
        ]);
    });

    it("reads again when the tutor announces a new session in the phase, live", async () => {
        const { vm, calls, timers, activityState } = createWarnings([[], [BASIC]]);
        await vm.$onInit();
        assert.deepEqual(vm.warnings, []);

        activityState.emit(SERVICE_INSTANTIATED_EVENT, { serviceId: "polyadic-devils-advocate", phaseId: 20 });
        activityState.emit(SERVICE_INSTANTIATED_EVENT, { serviceId: "argumentation-tutor-system", phaseId: 21 });
        assert.equal(timers.size, 0, "other services and phases are ignored");

        activityState.emit(SERVICE_INSTANTIATED_EVENT, { serviceId: "argumentation-tutor-system", phaseId: 20 });
        activityState.emit(SERVICE_INSTANTIATED_EVENT, { serviceId: "argumentation-tutor-system", phaseId: 20 });
        assert.equal(timers.size, 1, "announcements that arrive together are read once");

        const [timer] = timers;
        timers.delete(timer);
        await timer.callback();
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(calls.length, 2);
        assert.equal(vm.warnings.length, 1);
    });

    it("keeps the previous warnings when a read fails", async () => {
        const { vm } = createWarnings([[BASIC], new Error("offline")]);
        await vm.$onInit();

        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            await vm.load();
        } finally {
            console.warn = originalWarn;
        }

        assert.equal(vm.warnings.length, 1);
    });

    it("stops listening when it is destroyed", async () => {
        const { vm, timers, activityState } = createWarnings([[]]);
        await vm.$onInit();

        activityState.emit(SERVICE_INSTANTIATED_EVENT, { serviceId: "argumentation-tutor-system", phaseId: 20 });
        vm.$onDestroy();

        assert.equal(timers.size, 0);
        assert.deepEqual(activityState.listeners.get(SERVICE_INSTANTIATED_EVENT), []);
    });
});

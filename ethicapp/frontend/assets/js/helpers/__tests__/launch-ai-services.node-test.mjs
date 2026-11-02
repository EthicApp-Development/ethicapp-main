// The AI services card of the launch wizard's second step (#972, epic #965):
// each state, the switch, and the action bar's summary.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    AI_SERVICES_STATE,
    launchAiServicesFlag,
    launchAiServicesView,
} from "../launch-ai-services.js";

const NAMES = { tutor: "Tutor de argumentación", agent: "Agente de discusión" };
const serviceName = id => NAMES[id] ?? null;

const tutor = (phaseNumber, canRun = true) => ({ phaseNumber, serviceId: "tutor", canRun });
const agent = (phaseNumber, canRun = true) => ({ phaseNumber, serviceId: "agent", canRun });

describe("launchAiServicesView", () => {
    it("says the design uses no AI services", () => {
        const view = launchAiServicesView({ services: [], serviceName });

        assert.equal(view.state, AI_SERVICES_STATE.NONE);
        assert.equal(view.hasSwitch, false);
        assert.deepEqual(view.summary, { key: "launch_wizard_ai_summary_none", params: {} });
        assert.equal(launchAiServicesFlag(view), undefined);
    });

    it("offers the switch when every service can run, counting distinct services", () => {
        const view = launchAiServicesView({
            services: [tutor(3), agent(2), tutor(1)],
            serviceName,
        });

        assert.equal(view.state, AI_SERVICES_STATE.ALL);
        assert.equal(view.hasSwitch, true);
        assert.deepEqual(view.runnable.map(entry => [entry.phaseNumber, entry.name]), [
            [1, "Tutor de argumentación"],
            [2, "Agente de discusión"],
            [3, "Tutor de argumentación"],
        ]);
        assert.deepEqual(view.blocked, []);
        assert.deepEqual(view.summary, { key: "launch_wizard_ai_summary_other", params: { count: 2 } });
        assert.equal(launchAiServicesFlag(view), undefined, "the server keeps them on");
    });

    it("says \"with 1 AI service\" for one service", () => {
        const view = launchAiServicesView({ services: [tutor(1), tutor(2)], serviceName });
        assert.deepEqual(view.summary, { key: "launch_wizard_ai_summary_one", params: { count: 1 } });
    });

    it("offers the switch for the services that can run and lists the others apart", () => {
        const view = launchAiServicesView({
            services: [tutor(1), agent(2, false)],
            serviceName,
        });

        assert.equal(view.state, AI_SERVICES_STATE.SOME);
        assert.equal(view.hasSwitch, true);
        assert.deepEqual(view.runnable.map(entry => entry.serviceId), ["tutor"]);
        assert.deepEqual(view.blocked.map(entry => entry.serviceId), ["agent"]);
        assert.deepEqual(view.summary, { key: "launch_wizard_ai_summary_one", params: { count: 1 } });
    });

    it("shows no switch when no service can run", () => {
        const view = launchAiServicesView({
            services: [tutor(1, false), agent(2, false)],
            serviceName,
        });

        assert.equal(view.state, AI_SERVICES_STATE.UNAVAILABLE);
        assert.equal(view.hasSwitch, false);
        assert.deepEqual(view.runnable, []);
        assert.equal(view.blocked.length, 2);
        assert.deepEqual(view.summary, { key: "launch_wizard_ai_summary_unavailable", params: {} });
        assert.equal(launchAiServicesFlag(view), undefined);
    });

    it("turns the services off with the switch, and launches with aiServices false", () => {
        const all = launchAiServicesView({ services: [tutor(1), agent(2)], enabled: false, serviceName });
        assert.equal(all.state, AI_SERVICES_STATE.OFF);
        assert.equal(all.hasSwitch, true, "the switch stays to turn them back on");
        assert.equal(all.runnable.length, 2);
        assert.deepEqual(all.summary, { key: "launch_wizard_ai_summary_none", params: {} });
        assert.equal(launchAiServicesFlag(all), false);

        const some = launchAiServicesView({ services: [tutor(1), agent(2, false)], enabled: false, serviceName });
        assert.equal(some.state, AI_SERVICES_STATE.OFF);
        assert.deepEqual(some.blocked.map(entry => entry.serviceId), ["agent"]);
        assert.equal(launchAiServicesFlag(some), false);
    });

    it("ignores the switch when nothing can run", () => {
        const view = launchAiServicesView({ services: [tutor(1, false)], enabled: false, serviceName });
        assert.equal(view.state, AI_SERVICES_STATE.UNAVAILABLE);
        assert.equal(launchAiServicesFlag(view), undefined);
    });

    it("reports the check while it runs and when it fails", () => {
        const loading = launchAiServicesView({ loading: true });
        assert.equal(loading.state, AI_SERVICES_STATE.LOADING);
        assert.equal(loading.hasSwitch, false);
        assert.equal(loading.summary.key, "launch_wizard_ai_summary_checking");

        const failed = launchAiServicesView({ failed: true, services: [tutor(1)] });
        assert.equal(failed.state, AI_SERVICES_STATE.FAILED);
        assert.equal(failed.summary.key, "launch_wizard_ai_summary_unchecked");
        assert.equal(launchAiServicesFlag(failed), undefined);
    });

    it("leaves unknown names null and skips malformed entries", () => {
        const view = launchAiServicesView({
            services: [{ phaseNumber: 1, serviceId: "unknown", canRun: true }, { phaseNumber: 2 }, null],
            serviceName,
        });
        assert.deepEqual(view.runnable, [{ phaseNumber: 1, serviceId: "unknown", name: null, canRun: true }]);
        assert.equal(launchAiServicesView().state, AI_SERVICES_STATE.NONE);
    });
});

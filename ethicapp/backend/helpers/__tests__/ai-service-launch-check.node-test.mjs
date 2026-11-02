// checkDesignServicesBeforeLaunch (#969): the AI services a design enables, by
// phase, and whether each can run in an activity launched now. It applies the
// launch notice's rules (listServicesNotRunning) under the current AI service
// policy version, the one a launch would pin (#815). The registry is the real
// ExternalServicesRegistry over a fake policy store and connection, so the
// three causes are decided by the production rules, not by the test.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ExternalServicesRegistry } from "../../services/external-services.service.js";
import { checkDesignServicesBeforeLaunch } from "../ai-service-launch-notice.js";

// Version 1 allows nothing; version 2 allows polyadic-agent only.
const VERSIONS = new Map([
    [1, Object.freeze({ id: 1, allowedServiceIds: Object.freeze([]) })],
    [2, Object.freeze({ id: 2, allowedServiceIds: Object.freeze(["polyadic-agent"]) })],
]);

function makeRegistry({ currentVersionId = 2, connected = true } = {}) {
    const reads = [];
    const registry = new ExternalServicesRegistry({
        developmentAdapters:     false,
        isAiAdditionsConfigured: async () => connected,
        aiServicePolicy:         {
            async getCurrentPolicyVersion() {
                reads.push("current");
                return VERSIONS.get(currentVersionId);
            },
            async getPolicyVersion(id) {
                reads.push(`version:${id}`);
                return VERSIONS.get(Number(id)) ?? null;
            },
            async getSessionPolicyVersionId() {
                throw new Error("a launch check reads no session pin");
            },
        },
        roomJobsService: { hasOpenBoundRoomJob: async () => false },
        jobsService:     {},
    });
    registry.initialized = true;

    // Runs under version 2: it requires only polyadic-agent.
    registry.services.set("svc-allowed", {
        id: "svc-allowed", development: false, requires: ["polyadic-agent"],
    });
    // Never runs: no version allows case-analyst.
    registry.services.set("svc-disallowed", {
        id: "svc-disallowed", development: false, requires: ["polyadic-agent", "case-analyst"],
    });

    return { registry, reads };
}

const DESIGN = Object.freeze({
    phases: [
        { externalServices: { enabledServiceIds: ["svc-allowed", "svc-disallowed"] } },
        { externalServices: { enabledServiceIds: [] } },
        { externalServices: { enabledServiceIds: ["svc-allowed", "svc-unregistered"] } },
    ],
});

describe("checkDesignServicesBeforeLaunch", () => {
    it("lists each phase's services and whether the current version runs them", async () => {
        const { registry, reads } = makeRegistry({ currentVersionId: 2 });

        assert.deepEqual(await checkDesignServicesBeforeLaunch(DESIGN, { registry }), [
            { phaseNumber: 1, serviceId: "svc-allowed", canRun: true },
            // The policy does not allow it.
            { phaseNumber: 1, serviceId: "svc-disallowed", canRun: false },
            { phaseNumber: 3, serviceId: "svc-allowed", canRun: true },
            // No adapter is registered for it.
            { phaseNumber: 3, serviceId: "svc-unregistered", canRun: false },
        ]);
        assert.equal(reads[0], "current");
        assert.ok(reads.includes("version:2"));
    });

    it("reports a service the current version does not allow as not able to run", async () => {
        const { registry } = makeRegistry({ currentVersionId: 1 });
        const services = await checkDesignServicesBeforeLaunch(DESIGN, { registry });

        assert.ok(services.length > 0);
        assert.ok(services.every(({ canRun }) => canRun === false));
    });

    it("reports every production service as not able to run without a connection", async () => {
        const { registry } = makeRegistry({ connected: false });
        const services = await checkDesignServicesBeforeLaunch(
            JSON.stringify(DESIGN),
            { registry }
        );

        assert.deepEqual(services.map(({ serviceId, canRun }) => [serviceId, canRun]), [
            ["svc-allowed", false],
            ["svc-disallowed", false],
            ["svc-allowed", false],
            ["svc-unregistered", false],
        ]);
    });

    it("answers an empty list, reading no policy, for a design with no services", async () => {
        const { registry, reads } = makeRegistry();

        for (const design of [
            { phases: [{}, { externalServices: { enabledServiceIds: [" "] } }] },
            { phases: [] },
            {},
            null,
        ]) {
            assert.deepEqual(await checkDesignServicesBeforeLaunch(design, { registry }), []);
        }
        assert.deepEqual(reads, []);
    });
});

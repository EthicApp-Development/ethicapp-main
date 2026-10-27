import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ExternalServicesRegistry } from "../external-services.service.js";

// Per-adapter switches in the AI service policy (#864, epic #861). A version
// allows AI Additions services as a whole and may switch individual adapters
// of those services off. The registry is built from the shipped catalog, with
// stub adapter modules, so the test speaks about the real adapter ids.

const MANIFEST_PATH = fileURLToPath(
    new URL("../../external-services/manifest.json", import.meta.url)
);

const CASE_ANALYSES = [
    "case-analyst-evaluation",
    "case-analyst-evidence-inventory",
    "case-analyst-topic-listing",
];
const CLAIM_TYPOLOGY = "case-analyst-claim-typology";
const TUTOR = "argumentation-tutor-system";
const ALL_SERVICES = Object.freeze(["case-analyst", "argumentation-tutor", "polyadic-agent"]);

// A version that allows every AI Additions service and switches `disabled` off.
function version(id, disabled) {
    return Object.freeze({
        id,
        allowedServiceIds:  ALL_SERVICES,
        disabledAdapterIds: Object.freeze([...disabled]),
    });
}

const VERSIONS = new Map([
    // Switches nothing off.
    [1, version(1, [])],
    // Switches the design analysis off, keeps the case analyses.
    [2, version(2, [CLAIM_TYPOLOGY])],
    // The other way round.
    [3, version(3, CASE_ANALYSES)],
    // Switches the tutor off.
    [4, version(4, [TUTOR])],
]);

// Session 20 was launched under version 1, session 21 under version 4.
const SESSION_PINS = new Map([[20, 1], [21, 4]]);

function makePolicy(currentVersionId) {
    return {
        currentVersionId,
        async getCurrentPolicyVersion() {
            return VERSIONS.get(this.currentVersionId);
        },
        async getPolicyVersion(id) {
            return VERSIONS.get(Number(id)) ?? null;
        },
        async getSessionPolicyVersionId(sessionId) {
            return SESSION_PINS.get(Number(sessionId)) ?? null;
        },
    };
}

async function makeRegistry(currentVersionId) {
    const policy = makePolicy(currentVersionId);
    const registry = new ExternalServicesRegistry({
        developmentAdapters:     false,
        aiServicePolicy:         policy,
        isAiAdditionsConfigured: async () => true,
        importAdapter:           async () => ({
            register:            async () => {},
            getUiTranslations:   async () => null,
            designAnalysisInput: async () => ({ applies: false }),
        }),
        jobsService: {
            createJob:       async () => ({ id: null }),
            updateJobStatus: async () => {},
        },
        roomJobsService: { closeRoomJobs: async () => 0 },
    });

    const originalInfo = console.info;
    console.info = () => {};
    try {
        await registry.initialize(MANIFEST_PATH);
    } finally {
        console.info = originalInfo;
    }

    // Handlers that only record which adapter received which hook.
    const called = [];
    for (const service of registry.services.values()) {
        for (const hookName of service.hooks) {
            registry.subscribe(service.id, hookName, async () => {
                called.push(`${service.id}:${hookName}`);
            });
        }
    }

    return { registry, policy, called };
}

test("a version that switches nothing off enables every adapter of its services", async () => {
    const { registry } = await makeRegistry(1);

    assert.deepEqual(
        (await registry.getUsableServiceIdsForScope("case")).toSorted(),
        CASE_ANALYSES.toSorted()
    );
    assert.deepEqual(await registry.getUsableServiceIdsForScope("design"), [CLAIM_TYPOLOGY]);
    assert.equal(await registry.isServiceUsable(TUTOR), true);
});

test("switching the claim typology off stops design analyses, not case analyses", async () => {
    const { registry, called } = await makeRegistry(2);

    assert.deepEqual(await registry.getUsableServiceIdsForScope("design"), []);
    assert.deepEqual(
        (await registry.getUsableServiceIdsForScope("case")).toSorted(),
        CASE_ANALYSES.toSorted()
    );

    await registry.dispatchHook("case-created", { caseId: 5, userId: 7 }, {
        enabledServiceIds: [...CASE_ANALYSES, CLAIM_TYPOLOGY],
    });
    assert.deepEqual(called.toSorted(), CASE_ANALYSES.map(id => `${id}:case-created`).toSorted());
});

test("switching the case analyses off keeps the claim typology", async () => {
    const { registry, called } = await makeRegistry(3);

    assert.deepEqual(await registry.getUsableServiceIdsForScope("case"), []);
    assert.deepEqual(await registry.getUsableServiceIdsForScope("design"), [CLAIM_TYPOLOGY]);

    await registry.dispatchHook("case-created", { caseId: 5, userId: 7 }, {
        enabledServiceIds: CASE_ANALYSES,
    });
    assert.deepEqual(called, []);
});

test("listings and descriptor lookups leave switched-off adapters out", async () => {
    const { registry } = await makeRegistry(4);

    const listed = (await registry.listUsableServices()).map(service => service.id);
    assert.equal(listed.includes(TUTOR), false);
    assert.equal(listed.includes(CLAIM_TYPOLOGY), true);
    assert.equal(await registry.isServiceUsable(TUTOR), false);
    assert.equal(await registry.getServiceInstanceConfiguration(TUTOR, "en_US"), null);
});

test("session hooks follow the pinned version: a later switch-off spares running activities", async () => {
    const { registry, called } = await makeRegistry(4);

    await registry.dispatchHook("student-response-submitted", { sessionId: 20, phaseId: 1 }, {
        enabledServiceIds: [TUTOR],
    });
    await registry.dispatchHook("student-response-submitted", { sessionId: 21, phaseId: 1 }, {
        enabledServiceIds: [TUTOR],
    });

    assert.deepEqual(called, [`${TUTOR}:student-response-submitted`]);
});

test("isAllowedByPolicy: services allowed and the adapter not switched off", async () => {
    const { registry } = await makeRegistry(1);
    const typology = registry.getServiceById(CLAIM_TYPOLOGY);

    assert.equal(registry.isAllowedByPolicy(typology, VERSIONS.get(1)), true);
    assert.equal(registry.isAllowedByPolicy(typology, VERSIONS.get(2)), false);
    // A version read without the column (older shape) switches nothing off.
    const olderShape = { id: 9, allowedServiceIds: ["case-analyst"] };
    assert.equal(registry.isAllowedByPolicy(typology, olderShape), true);
    // Switching an adapter off never allows a service the version does not allow.
    const allowsNothing = { id: 9, allowedServiceIds: [], disabledAdapterIds: [] };
    assert.equal(registry.isAllowedByPolicy(typology, allowsNothing), false);
    // Another adapter's id does not affect it.
    assert.equal(registry.isAllowedByPolicy(typology, VERSIONS.get(3)), true);
});

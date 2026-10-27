import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ExternalServicesRegistry } from "../../services/external-services.service.js";

// Registers the shipped catalog with its real adapters (#812). Registering
// must have no outbound side effects, so every fetch() fails the test.

const MANIFEST_PATH = fileURLToPath(new URL("../manifest.json", import.meta.url));

const PRODUCTION_IDS  = [
    "polyadic-devils-advocate",
    "argumentation-tutor-system",
    "case-analyst-evaluation",
    "case-analyst-evidence-inventory",
];
const DEVELOPMENT_IDS = [
    "mock-ai-response-review",
    "mock-chat-agent",
    "mock-case-analysis",
    "mock-design-analysis",
];

async function registerWithoutNetwork({
    developmentAdapters,
    env,
    aiServicePolicy,
    isAiAdditionsConfigured = async () => false,
} = {}) {
    const fetchCalls     = [];
    const originalFetch  = globalThis.fetch;
    const originalWarn   = console.warn;
    const originalInfo   = console.info;
    const originalEnv    = process.env.EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS;
    const jobsCalls      = [];
    const jobsService    = new Proxy({}, {
        get: (target, name) => async (...args) => {
            jobsCalls.push({ name, args });
            return null;
        },
    });

    globalThis.fetch = async (url) => {
        fetchCalls.push(String(url));
        throw new Error(`Registration must not call ${url}`);
    };
    console.warn = () => {};
    console.info = () => {};
    if (env === undefined) {
        delete process.env.EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS;
    } else {
        process.env.EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS = env;
    }

    try {
        const registry = new ExternalServicesRegistry({
            jobsService,
            developmentAdapters,
            aiServicePolicy,
            isAiAdditionsConfigured,
        });
        await registry.initialize(MANIFEST_PATH);
        // Let work an adapter started without awaiting it reach fetch() too.
        await new Promise(resolve => setTimeout(resolve, 20));
        return { registry, fetchCalls, jobsCalls };
    } finally {
        globalThis.fetch = originalFetch;
        console.warn     = originalWarn;
        console.info     = originalInfo;
        if (originalEnv === undefined) {
            delete process.env.EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS;
        } else {
            process.env.EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS = originalEnv;
        }
    }
}

function subscribedServiceIds(registry) {
    const ids = new Set();
    for (const subscribers of registry.hookSubscribers.values()) {
        subscribers.forEach(({ serviceId }) => ids.add(serviceId));
    }
    return [...ids].sort();
}

test("registration: every production adapter registers, with no network call", async () => {
    const { registry, fetchCalls, jobsCalls } = await registerWithoutNetwork({ developmentAdapters: false });

    assert.deepEqual([...registry.services.keys()].sort(), [...PRODUCTION_IDS].sort());
    assert.deepEqual(subscribedServiceIds(registry), [...PRODUCTION_IDS].sort());
    assert.deepEqual(fetchCalls, []);
    assert.deepEqual(jobsCalls, []);
});

test("registration: development adapters register only with the development variable", async () => {
    const off = await registerWithoutNetwork({ env: undefined });
    assert.deepEqual([...off.registry.services.keys()].sort(), [...PRODUCTION_IDS].sort());

    const explicitFalse = await registerWithoutNetwork({ env: "false" });
    assert.deepEqual([...explicitFalse.registry.services.keys()].sort(), [...PRODUCTION_IDS].sort());

    const on = await registerWithoutNetwork({ env: "true" });
    assert.deepEqual(
        [...on.registry.services.keys()].sort(),
        [...PRODUCTION_IDS, ...DEVELOPMENT_IDS].sort()
    );
    assert.deepEqual(subscribedServiceIds(on.registry), [...PRODUCTION_IDS, ...DEVELOPMENT_IDS].sort());
    assert.deepEqual(on.fetchCalls, []);
});

// The policy gate (#815) over the shipped catalog: production adapters are
// usable only when the current version allows what they require and a
// connection exists; development adapters whenever they are registered.
function policyAllowing(allowedServiceIds) {
    const version = Object.freeze({ id: 2, allowedServiceIds: Object.freeze(allowedServiceIds) });
    return {
        getCurrentPolicyVersion:   async () => version,
        getPolicyVersion:          async () => version,
        getSessionPolicyVersionId: async () => version.id,
    };
}

async function usableIds(registry) {
    return (await registry.listUsableServices()).map(service => service.id).sort();
}

test("registration: the policy gate decides which shipped adapters are usable", async () => {
    const everything = await registerWithoutNetwork({
        developmentAdapters:     true,
        aiServicePolicy:         policyAllowing(["polyadic-agent", "argumentation-tutor", "case-analyst"]),
        isAiAdditionsConfigured: async () => true,
    });
    assert.deepEqual(await usableIds(everything.registry), [...PRODUCTION_IDS, ...DEVELOPMENT_IDS].sort());
    assert.deepEqual(
        await everything.registry.getUsableServiceIdsForScope("case"),
        ["case-analyst-evaluation", "case-analyst-evidence-inventory", "mock-case-analysis"]
    );
    assert.deepEqual(
        await everything.registry.getUsableServiceIdsForScope("design"),
        ["mock-design-analysis"]
    );
    assert.equal(
        typeof everything.registry.getDesignAnalysisInputBuilder("mock-design-analysis"),
        "function"
    );

    const caseAnalystOnly = await registerWithoutNetwork({
        developmentAdapters:     false,
        aiServicePolicy:         policyAllowing(["case-analyst"]),
        isAiAdditionsConfigured: async () => true,
    });
    assert.deepEqual(
        await usableIds(caseAnalystOnly.registry),
        ["case-analyst-evaluation", "case-analyst-evidence-inventory"]
    );

    const noConnection = await registerWithoutNetwork({
        developmentAdapters:     true,
        aiServicePolicy:         policyAllowing(["polyadic-agent", "argumentation-tutor", "case-analyst"]),
        isAiAdditionsConfigured: async () => false,
    });
    assert.deepEqual(await usableIds(noConnection.registry), [...DEVELOPMENT_IDS].sort());
    for (const serviceId of PRODUCTION_IDS) {
        assert.equal(await noConnection.registry.isServiceUsable(serviceId), false, serviceId);
    }
    for (const serviceId of DEVELOPMENT_IDS) {
        assert.equal(await noConnection.registry.isServiceUsable(serviceId), true, serviceId);
    }
});

import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ExternalServicesRegistry } from "../../services/external-services.service.js";

// Registers the shipped catalog with its real adapters (#812). Registering
// must have no outbound side effects, so every fetch() fails the test.

const MANIFEST_PATH = fileURLToPath(new URL("../manifest.json", import.meta.url));

const PRODUCTION_IDS  = ["polyadic-devils-advocate", "argumentation-tutor-system", "case-analyst"];
const DEVELOPMENT_IDS = ["mock-ai-response-review", "mock-chat-agent", "mock-case-analysis"];

async function registerWithoutNetwork({ developmentAdapters, env } = {}) {
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
        const registry = new ExternalServicesRegistry({ jobsService, developmentAdapters });
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

// Interim rule until the service policy (#815): no production adapter is usable.
test("registration: production adapters are registered but not usable before #815", async () => {
    const { registry } = await registerWithoutNetwork({ developmentAdapters: true });

    for (const serviceId of PRODUCTION_IDS) {
        assert.equal(registry.isServiceUsable(serviceId), false, serviceId);
    }
    for (const serviceId of DEVELOPMENT_IDS) {
        assert.equal(registry.isServiceUsable(serviceId), true, serviceId);
    }
    assert.deepEqual(registry.getUsableServiceIdsForScope("case"), ["mock-case-analysis"]);
    assert.deepEqual(
        registry.listServices().filter(service => service.usable).map(service => service.id).sort(),
        [...DEVELOPMENT_IDS].sort()
    );
});

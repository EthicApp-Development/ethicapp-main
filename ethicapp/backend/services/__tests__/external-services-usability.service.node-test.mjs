import assert from "node:assert/strict";
import test from "node:test";
import { ExternalServicesRegistry } from "../external-services.service.js";

// The usability seam (#812): until the service policy (#815), no production
// adapter receives events; development adapters do when
// EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS is true. Callbacks are not gated.

const JOB_UUID    = "c1d2e3f4-0000-4000-8000-000000000021";
const RESULT_UUID = "c1d2e3f4-0000-4000-8000-000000000022";

function makeRegistry({ developmentAdapters = true } = {}) {
    const createdJobs = [];
    const createdResults = [];
    const registry = new ExternalServicesRegistry({
        developmentAdapters,
        jobsService: {
            createJob:       async args => { createdJobs.push(args); return { id: JOB_UUID }; },
            updateJobStatus: async () => {},
            createResult:    async args => { createdResults.push(args); return { id: RESULT_UUID, job_id: JOB_UUID }; },
            updateResult:    async () => {},
        },
        capabilityDescriptors: {
            getInstanceConfiguration: async () => ({ available: true, fields: [] }),
        },
    });
    registry.initialized = true;

    registry.services.set("svc-production", {
        id:           "svc-production",
        development:  false,
        requires:     ["polyadic-agent"],
        hooks:        ["phase-started", "case-created", "callback-received"],
        globalHooks:  ["case-created"],
        scopes:       ["case", "chat"],
        descriptor:   { serviceId: "polyadic-agent", path: "/polyadic-agent/api/capabilities" },
        callbackAuth: null,
    });
    registry.services.set("svc-development", {
        id:           "svc-development",
        development:  true,
        requires:     [],
        hooks:        ["phase-started", "case-created", "callback-received"],
        globalHooks:  ["case-created"],
        scopes:       ["case", "chat"],
        callbackAuth: null,
    });

    const called = [];
    for (const hookName of ["phase-started", "case-created", "callback-received"]) {
        registry.hookSubscribers.set(hookName, ["svc-production", "svc-development"].map(serviceId => ({
            serviceId,
            handler: async () => { called.push(`${serviceId}:${hookName}`); },
        })));
    }

    return { registry, called, createdJobs, createdResults };
}

test("isServiceUsable: production adapters never, development ones with the variable", () => {
    const on  = makeRegistry({ developmentAdapters: true }).registry;
    const off = makeRegistry({ developmentAdapters: false }).registry;

    assert.equal(on.isServiceUsable("svc-production"), false);
    assert.equal(on.isServiceUsable("svc-development"), true);
    assert.equal(on.isServiceUsable("unknown"), false);
    assert.equal(off.isServiceUsable("svc-production"), false);
    assert.equal(off.isServiceUsable("svc-development"), false);
});

test("usableServiceIds: keeps the usable ids once, in order", () => {
    const { registry } = makeRegistry();

    assert.deepEqual(
        registry.usableServiceIds(["svc-production", "svc-development", "unknown", "svc-development"]),
        ["svc-development"]
    );
    assert.deepEqual(registry.usableServiceIds(), []);
});

test("dispatchHook: a design that enables a production adapter does not reach it", async () => {
    const { registry, called, createdJobs } = makeRegistry();

    const results = await registry.dispatchHook("phase-started", { sessionId: 1, phaseId: 2 }, {
        enabledServiceIds: ["svc-production", "svc-development"],
    });

    assert.equal(results.length, 1);
    assert.deepEqual(called, ["svc-development:phase-started"]);
    assert.deepEqual(createdJobs.map(job => job.serviceId), ["svc-development"]);
});

test("dispatchHook: nothing is dispatched, and no job created, for production adapters only", async () => {
    const { registry, called, createdJobs } = makeRegistry();

    const results = await registry.dispatchHook("phase-started", {}, {
        enabledServiceIds: ["svc-production"],
    });

    assert.deepEqual(results, []);
    assert.deepEqual(called, []);
    assert.deepEqual(createdJobs, []);
});

test("dispatchGlobalHook: production adapters are skipped", async () => {
    const { registry, called } = makeRegistry();

    await registry.dispatchGlobalHook("case-created", { caseId: 3 });

    assert.deepEqual(called, ["svc-development:case-created"]);
});

test("listings and descriptors: only usable services are offered", async () => {
    const { registry } = makeRegistry();

    assert.deepEqual(registry.getUsableServiceIdsForScope("case"), ["svc-development"]);
    assert.deepEqual(registry.getUsableServiceIdsForGlobalHook("case-created"), ["svc-development"]);
    assert.deepEqual(
        registry.listServices().map(({ id, usable, development, requires }) => ({
            id, usable, development, requires,
        })),
        [
            { id: "svc-production", usable: false, development: false, requires: ["polyadic-agent"] },
            { id: "svc-development", usable: true, development: true, requires: [] },
        ]
    );
    assert.equal(await registry.getServiceInstanceConfiguration("svc-production", "en_US"), null);
});

test("callbacks: accepted for a registered production adapter that is not usable", async () => {
    const { registry, called, createdResults } = makeRegistry();

    assert.doesNotThrow(() => registry.authorizeCallbackCaller("svc-production", { clientId: "x" }));
    const { outcomes } = await registry.dispatchServiceHook("callback-received", "svc-production", {
        correlationId: JOB_UUID,
    });

    assert.equal(outcomes.length, 1);
    assert.deepEqual(called, ["svc-production:callback-received"]);
    assert.equal(createdResults[0].serviceId, "svc-production");
});

test("callbacks: 404 for an adapter that is not registered", async () => {
    const { registry } = makeRegistry();

    assert.throws(() => registry.authorizeCallbackCaller("unknown", {}), { statusCode: 404 });
    await assert.rejects(() => registry.dispatchServiceHook("callback-received", "unknown", {}), {
        statusCode: 404,
    });
});

test("registerService: a development adapter is skipped, and not imported, without the variable", async () => {
    const imported = [];
    const originalInfo = console.info;
    console.info = () => {};

    try {
        for (const developmentAdapters of [false, true]) {
            const registry = new ExternalServicesRegistry({
                jobsService:   {},
                developmentAdapters,
                importAdapter: async href => { imported.push(href); return { register: async () => {} }; },
            });

            await registry.registerService({
                id:          "svc-mock",
                adapter:     "./adapters/mock.adapter.js",
                development: true,
                requires:    [],
                scopes:      ["chat"],
            }, "/catalog/manifest.json");

            assert.equal(registry.services.has("svc-mock"), developmentAdapters, String(developmentAdapters));
        }
    } finally {
        console.info = originalInfo;
    }

    assert.deepEqual(imported, ["file:///catalog/adapters/mock.adapter.js"]);
});

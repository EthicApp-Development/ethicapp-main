import assert from "node:assert/strict";
import test from "node:test";
import { ExternalServicesRegistry } from "../external-services.service.js";

// The usability seam (#812): until the service policy (#815), no production
// adapter receives events; development adapters do when
// EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS is true. Callbacks for jobs that
// already exist are the one exception.

const JOB_UUID       = "c1d2e3f4-0000-4000-8000-000000000021";
const RESULT_UUID    = "c1d2e3f4-0000-4000-8000-000000000022";
const OTHER_JOB_UUID = "c1d2e3f4-0000-4000-8000-000000000023";
const UNKNOWN_UUID   = "c1d2e3f4-0000-4000-8000-000000000024";

// Persisted jobs and the service each belongs to.
const JOBS = new Map([
    [JOB_UUID, "svc-production"],
    [OTHER_JOB_UUID, "svc-development"],
]);

// Like the real createResult(): the correlation id matches a job only when
// that job belongs to the calling service; the result is recorded either way.
async function createResultLikeTheJobsService({ correlationId, serviceId }) {
    const matches = Boolean(correlationId) && JOBS.get(correlationId) === serviceId;
    return {
        id:         RESULT_UUID,
        job_id:     matches ? correlationId : null,
        service_id: serviceId,
        status:     matches ? "callback_received" : "unknown_correlation",
    };
}

function makeRegistry({
    developmentAdapters = true,
    createResult = createResultLikeTheJobsService,
} = {}) {
    const createdJobs = [];
    const createdResults = [];
    const jobStatuses = [];
    const registry = new ExternalServicesRegistry({
        developmentAdapters,
        jobsService: {
            createJob:       async args => { createdJobs.push(args); return { id: JOB_UUID }; },
            updateJobStatus: async (jobId, status) => { jobStatuses.push({ jobId, status }); },
            createResult:    async args => { createdResults.push(args); return createResult(args); },
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

    // Each handler records that it ran (its side effect) and closes its job.
    const called = [];
    for (const hookName of ["phase-started", "case-created", "callback-received"]) {
        registry.hookSubscribers.set(hookName, ["svc-production", "svc-development"].map(serviceId => ({
            serviceId,
            handler: async (context, { callback }) => {
                called.push(`${serviceId}:${hookName}`);
                return callback({ status: "completed" });
            },
        })));
    }

    return { registry, called, createdJobs, createdResults, jobStatuses };
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

test("callbacks: an existing job of an unusable production adapter still completes", async () => {
    const { registry, called, createdResults, jobStatuses } = makeRegistry();

    assert.doesNotThrow(() => registry.authorizeCallbackCaller("svc-production", { clientId: "x" }));
    const { resultRecord, outcomes } = await registry.dispatchServiceHook(
        "callback-received",
        "svc-production",
        { correlationId: JOB_UUID }
    );

    assert.equal(resultRecord.job_id, JOB_UUID);
    assert.deepEqual(outcomes.map(outcome => outcome.status), ["fulfilled"]);
    assert.deepEqual(called, ["svc-production:callback-received"]);
    assert.equal(createdResults[0].serviceId, "svc-production");
    assert.deepEqual(jobStatuses.map(({ jobId, status }) => ({ jobId, status })), [
        { jobId: JOB_UUID, status: "completed" },
    ]);
});

// An unusable adapter must not act on a callback that matches none of its
// jobs: its handler never runs, though the result is still recorded.
const UNMATCHED_CALLBACKS = {
    "no correlation id":                {},
    "an unknown correlation id":        { correlationId: UNKNOWN_UUID },
    "another service's correlation id": { correlationId: OTHER_JOB_UUID },
};

for (const [label, context] of Object.entries(UNMATCHED_CALLBACKS)) {
    test(`callbacks: 409 and no handler for an unusable adapter with ${label}`, async () => {
        const { registry, called, createdResults, jobStatuses } = makeRegistry();

        await assert.rejects(
            () => registry.dispatchServiceHook("callback-received", "svc-production", context),
            { statusCode: 409 }
        );

        assert.deepEqual(called, []);
        assert.deepEqual(jobStatuses, []);
        assert.equal(createdResults.length, 1, "the callback is still recorded");
    });
}

test("callbacks: 409 when the matched job belongs to another service", async () => {
    const { registry, called } = makeRegistry({
        createResult: async () => ({ id: RESULT_UUID, job_id: OTHER_JOB_UUID, service_id: "svc-development" }),
    });

    await assert.rejects(
        () => registry.dispatchServiceHook("callback-received", "svc-production", {
            correlationId: OTHER_JOB_UUID,
        }),
        { statusCode: 409 }
    );
    assert.deepEqual(called, []);
});

test("callbacks: 503 and no handler for an unusable adapter when the lookup fails", async () => {
    for (const createResult of [
        async () => { throw new Error("database unavailable"); },
        async () => null,
    ]) {
        const { registry, called, jobStatuses } = makeRegistry({ createResult });

        await assert.rejects(
            () => registry.dispatchServiceHook("callback-received", "svc-production", {
                correlationId: JOB_UUID,
            }),
            { statusCode: 503 }
        );
        assert.deepEqual(called, []);
        assert.deepEqual(jobStatuses, []);
    }
});

// Usable services keep the behavior they had before #812: their callbacks
// are delivered with or without a matching job.
test("callbacks: a usable adapter still receives callbacks without a matching job", async () => {
    for (const createResult of [createResultLikeTheJobsService, async () => null]) {
        const { registry, called } = makeRegistry({ createResult });

        const { outcomes } = await registry.dispatchServiceHook(
            "callback-received",
            "svc-development",
            {}
        );

        assert.equal(outcomes.length, 1);
        assert.deepEqual(called, ["svc-development:callback-received"]);
    }
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

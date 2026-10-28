import assert from "node:assert/strict";
import test from "node:test";
import { ExternalServicesRegistry } from "../external-services.service.js";
import { JOB_STATUS, RESULT_STATUS } from "../external-service-jobs.service.js";
import { captureWarnings } from "./capture-warnings.mjs";

const JOB_UUID    = "b1c2d3e4-0000-4000-8000-000000000011";
const RESULT_UUID = "b1c2d3e4-0000-4000-8000-000000000012";

function makeJobsServiceStub(overrides = {}) {
    return {
        createJob:               async () => ({ id: JOB_UUID }),
        updateJobStatus:         async () => {},
        createResult:            async () => ({ id: RESULT_UUID, job_id: JOB_UUID }),
        // Consumes the result right before handlers run (#815).
        claimResult:             async result => ({ ...result }),
        updateResult:            async () => {},
        recordProviderReference: async () => {},
        ...overrides,
    };
}

// Adapters registered by these tests are never imported: each one gets an
// empty register() and no UI texts.
const importNoopAdapter = async () => ({
    register:          async () => {},
    getUiTranslations: () => null,
});

// Development adapters pass the policy gate whatever the policy (#815), so the
// services these tests dispatch to are development ones (#812).
function makeRegistry(jobsServiceOverrides = {}) {
    const jobsService = makeJobsServiceStub(jobsServiceOverrides);
    const registry = new ExternalServicesRegistry({
        jobsService,
        developmentAdapters: true,
        importAdapter:       importNoopAdapter,
        // The current policy version allows nothing, and there is no
        // connection (#815): only development adapters are usable.
        aiServicePolicy:     {
            getCurrentPolicyVersion: async () => ({ id: 1, allowedServiceIds: [] }),
        },
        isAiAdditionsConfigured: async () => false,
    });
    registry.initialized = true;
    registry.services.set("svc-a", { id: "svc-a", development: true });
    return { registry, jobsService };
}

// ─── _dispatchOneHandler ──────────────────────────────────────────────────────

test("dispatchHook: enriches context with jobId and correlationId", async () => {
    let capturedContext = null;
    const { registry } = makeRegistry();

    registry.hookSubscribers.set("phase-started", [
        {
            serviceId: "svc-a",
            handler:   async (ctx) => { capturedContext = ctx; },
        },
    ]);

    await registry.dispatchHook("phase-started", { sessionId: 5, phaseId: 10 }, {
        enabledServiceIds: ["svc-a"],
    });

    assert.ok(capturedContext, "handler should have been called");
    assert.equal(capturedContext.jobId, JOB_UUID);
    assert.equal(capturedContext.correlationId, JOB_UUID);
    assert.equal(capturedContext.serviceId, "svc-a");
});

test("dispatchHook: creates job with context fields", async () => {
    const calls = [];
    const { registry } = makeRegistry({
        createJob: async (args) => {
            calls.push(args);
            return { id: JOB_UUID };
        },
    });

    registry.hookSubscribers.set("phase-started", [
        { serviceId: "svc-a", handler: async () => {} },
    ]);

    await registry.dispatchHook(
        "phase-started",
        { sessionId: 1, phaseId: 2, questionId: 3, groupId: 4, userId: 5 },
        { enabledServiceIds: ["svc-a"] }
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].serviceId, "svc-a");
    assert.equal(calls[0].hookName, "phase-started");
    assert.equal(calls[0].sessionId, 1);
    assert.equal(calls[0].phaseId, 2);
});

test("dispatchHook: marks job dispatched before calling handler", async () => {
    const statusCalls = [];
    let handlerCalledAfterDispatch = false;
    const { registry } = makeRegistry({
        updateJobStatus: async (id, status) => {
            statusCalls.push({ id, status });
            if (status === JOB_STATUS.DISPATCHED) {
                handlerCalledAfterDispatch = false;
            }
        },
    });

    registry.hookSubscribers.set("phase-started", [
        {
            serviceId: "svc-a",
            handler:   async () => { handlerCalledAfterDispatch = true; },
        },
    ]);

    await registry.dispatchHook("phase-started", {}, { enabledServiceIds: ["svc-a"] });

    const dispatchedCall = statusCalls.find(c => c.status === JOB_STATUS.DISPATCHED);
    assert.ok(dispatchedCall, "should mark job as dispatched");
    assert.equal(dispatchedCall.id, JOB_UUID);
    assert.ok(handlerCalledAfterDispatch, "handler should have been called");
});

test("dispatchHook: marks job failed when handler throws", async () => {
    const statusCalls = [];
    const { registry } = makeRegistry({
        updateJobStatus: async (id, status) => { statusCalls.push({ id, status }); },
    });

    registry.hookSubscribers.set("phase-started", [
        { serviceId: "svc-a", handler: async () => { throw new Error("adapter error"); } },
    ]);

    const results = await registry.dispatchHook("phase-started", {}, {
        enabledServiceIds: ["svc-a"],
    });

    assert.equal(results[0].status, "rejected");
    const failedCall = statusCalls.find(c => c.status === JOB_STATUS.FAILED);
    assert.ok(failedCall, "should mark job as failed");
});

test("dispatchHook: continues if createJob rejects — jobId null in context", async () => {
    let capturedContext = null;
    const { registry } = makeRegistry({
        createJob: async () => { throw new Error("db down"); },
    });

    registry.hookSubscribers.set("phase-started", [
        { serviceId: "svc-a", handler: async (ctx) => { capturedContext = ctx; } },
    ]);

    await registry.dispatchHook("phase-started", {}, { enabledServiceIds: ["svc-a"] });

    assert.ok(capturedContext, "handler should still be called");
    assert.equal(capturedContext.jobId, null);
    assert.equal(capturedContext.correlationId, null);
});

test("dispatchHook: creates each job with the id preset for its service", async () => {
    const PRESET_UUID = "b1c2d3e4-0000-4000-8000-000000000013";
    const createdIds  = new Map();
    const contexts    = new Map();
    const { registry } = makeRegistry({
        createJob: async ({ id, serviceId }) => {
            createdIds.set(serviceId, id);
            return { id: id ?? JOB_UUID };
        },
    });
    registry.services.set("svc-b", { id: "svc-b", development: true });

    registry.hookSubscribers.set("case-created", ["svc-a", "svc-b"].map(serviceId => ({
        serviceId,
        handler: async (ctx) => { contexts.set(serviceId, ctx); },
    })));

    await registry.dispatchHook("case-created", { caseId: 7 }, {
        enabledServiceIds: ["svc-a", "svc-b"],
        jobIds:            { "svc-a": PRESET_UUID },
    });

    assert.equal(createdIds.get("svc-a"), PRESET_UUID);
    assert.equal(createdIds.get("svc-b"), null);
    assert.equal(contexts.get("svc-a").jobId, PRESET_UUID);
    assert.equal(contexts.get("svc-a").correlationId, PRESET_UUID);
    assert.equal(contexts.get("svc-b").jobId, JOB_UUID);
});

test("dispatchHook: keeps the preset id in context when createJob rejects", async () => {
    const PRESET_UUID = "b1c2d3e4-0000-4000-8000-000000000014";
    let capturedContext = null;
    const { registry } = makeRegistry({
        createJob: async () => { throw new Error("db down"); },
    });

    registry.hookSubscribers.set("case-created", [
        { serviceId: "svc-a", handler: async (ctx) => { capturedContext = ctx; } },
    ]);

    await registry.dispatchHook("case-created", { caseId: 7 }, {
        enabledServiceIds: ["svc-a"],
        jobIds:            { "svc-a": PRESET_UUID },
    });

    assert.equal(capturedContext.jobId, PRESET_UUID);
    assert.equal(capturedContext.correlationId, PRESET_UUID);
});

test("dispatchHook: returns [] when enabledServiceIds is empty", async () => {
    const { registry } = makeRegistry();
    const result = await registry.dispatchHook("phase-started", {}, {});
    assert.deepEqual(result, []);
});

// ─── dispatchServiceHook ──────────────────────────────────────────────────────

test("dispatchServiceHook: creates result record before calling handler", async () => {
    const createResultCalls = [];
    const { registry } = makeRegistry({
        createResult: async (args) => {
            createResultCalls.push(args);
            return { id: RESULT_UUID, job_id: JOB_UUID };
        },
    });

    registry.hookSubscribers.set("callback-received", [
        { serviceId: "svc-a", handler: async () => {} },
    ]);

    await registry.dispatchServiceHook(
        "callback-received",
        "svc-a",
        { correlationId: JOB_UUID, sessionId: 7, requestPayload: { x: 1 } }
    );

    assert.equal(createResultCalls.length, 1);
    assert.equal(createResultCalls[0].serviceId, "svc-a");
    assert.equal(createResultCalls[0].correlationId, JOB_UUID);
    assert.deepEqual(createResultCalls[0].rawPayload, { x: 1 });
    assert.equal(createResultCalls[0].sessionId, 7);
});

test("dispatchServiceHook: threads eventId from context into createResult", async () => {
    const EVENT_UUID        = "e1e2e3e4-0000-4000-8000-000000000099";
    const createResultCalls = [];
    const { registry } = makeRegistry({
        createResult: async (args) => {
            createResultCalls.push(args);
            return { id: RESULT_UUID, job_id: JOB_UUID };
        },
    });

    registry.hookSubscribers.set("callback-received", [
        { serviceId: "svc-a", handler: async () => {} },
    ]);

    await registry.dispatchServiceHook(
        "callback-received",
        "svc-a",
        { correlationId: JOB_UUID, eventId: EVENT_UUID }
    );

    assert.equal(createResultCalls[0].eventId, EVENT_UUID);
});

test("dispatchServiceHook: enriches handler context with jobId and resultId", async () => {
    let capturedContext = null;
    const { registry } = makeRegistry();

    registry.hookSubscribers.set("callback-received", [
        { serviceId: "svc-a", handler: async (ctx) => { capturedContext = ctx; } },
    ]);

    await registry.dispatchServiceHook("callback-received", "svc-a", {});

    assert.ok(capturedContext);
    assert.equal(capturedContext.jobId, JOB_UUID);
    assert.equal(capturedContext.resultId, RESULT_UUID);
});

test("dispatchServiceHook: falls back to rawBody when requestPayload absent", async () => {
    const createResultCalls = [];
    const { registry } = makeRegistry({
        createResult: async (args) => {
            createResultCalls.push(args);
            return { id: RESULT_UUID, job_id: JOB_UUID };
        },
    });

    registry.hookSubscribers.set("callback-received", [
        { serviceId: "svc-a", handler: async () => {} },
    ]);

    await registry.dispatchServiceHook(
        "callback-received",
        "svc-a",
        { correlationId: JOB_UUID, rawBody: { raw: true } }
    );

    assert.deepEqual(createResultCalls[0].rawPayload, { raw: true });
});

test("dispatchServiceHook: throws 404 for unknown service", async () => {
    const { registry } = makeRegistry();
    await assert.rejects(
        () => registry.dispatchServiceHook("callback-received", "unknown-svc", {}),
        err => err.statusCode === 404
    );
});

test("dispatchServiceHook: marks result FAILED when handler throws", async () => {
    const updateResultCalls = [];
    const { registry } = makeRegistry({
        updateResult: async (id, args) => { updateResultCalls.push({ id, ...args }); },
    });

    registry.hookSubscribers.set("callback-received", [
        { serviceId: "svc-a", handler: async () => { throw new Error("handler error"); } },
    ]);

    const { outcomes } = await registry.dispatchServiceHook("callback-received", "svc-a", {});

    assert.equal(outcomes[0].status, "rejected");
    assert.equal(updateResultCalls.length, 1);
    assert.equal(updateResultCalls[0].id, RESULT_UUID);
    assert.equal(updateResultCalls[0].status, RESULT_STATUS.FAILED);
});

test("dispatchServiceHook: returns resultRecord alongside outcomes", async () => {
    const { registry } = makeRegistry();

    registry.hookSubscribers.set("callback-received", [
        { serviceId: "svc-a", handler: async () => {} },
    ]);

    const response = await registry.dispatchServiceHook("callback-received", "svc-a", {});

    assert.ok(Object.hasOwn(response, "resultRecord"), "should have resultRecord key");
    assert.ok(Object.hasOwn(response, "outcomes"),     "should have outcomes key");
    assert.ok(Array.isArray(response.outcomes));
    assert.equal(response.resultRecord?.id, RESULT_UUID);
});

test("dispatchServiceHook: skips handlers and returns empty outcomes when is_duplicate", async () => {
    let handlerCalled = false;
    const { registry } = makeRegistry({
        createResult: async () => ({
            id:               RESULT_UUID,
            job_id:           JOB_UUID,
            job_prior_status: "completed",
            is_duplicate:     true,
        }),
    });

    registry.hookSubscribers.set("callback-received", [
        { serviceId: "svc-a", handler: async () => { handlerCalled = true; } },
    ]);

    const { resultRecord, outcomes } = await registry.dispatchServiceHook(
        "callback-received", "svc-a", {}
    );

    assert.equal(handlerCalled, false, "handler must not run for duplicate callbacks");
    assert.deepEqual(outcomes, []);
    assert.equal(resultRecord?.id, RESULT_UUID);
});

test("dispatchServiceHook: isDuplicate is false for non-terminal job", async () => {
    let capturedContext = null;
    const { registry } = makeRegistry();

    registry.hookSubscribers.set("callback-received", [
        { serviceId: "svc-a", handler: async (ctx) => { capturedContext = ctx; } },
    ]);

    await registry.dispatchServiceHook("callback-received", "svc-a", {});

    assert.equal(capturedContext?.isDuplicate, false);
});

// ─── recordCallbackResult ─────────────────────────────────────────────────────

test("recordCallbackResult: calls updateResult when context has resultId", async () => {
    const updateResultCalls = [];
    const { registry } = makeRegistry({
        updateResult: async (id, args) => { updateResultCalls.push({ id, ...args }); },
    });

    await registry.recordCallbackResult({
        hookName:  "callback-received",
        serviceId: "svc-a",
        result:    { score: 42 },
        context:   { resultId: RESULT_UUID, serviceId: "svc-a" },
    });

    assert.equal(updateResultCalls.length, 1);
    assert.equal(updateResultCalls[0].id, RESULT_UUID);
    assert.equal(updateResultCalls[0].status, RESULT_STATUS.COMPLETED);
    assert.deepEqual(updateResultCalls[0].adapterResult, { score: 42 });
});

test("recordCallbackResult: maps result.status 'failed' to RESULT_STATUS.FAILED", async () => {
    const updateResultCalls = [];
    const { registry } = makeRegistry({
        updateResult: async (id, args) => { updateResultCalls.push({ id, ...args }); },
    });

    await registry.recordCallbackResult({
        hookName:  "callback-received",
        serviceId: "svc-a",
        result:    { status: "failed", reason: "room not found" },
        context:   { resultId: RESULT_UUID },
    });

    assert.equal(updateResultCalls[0].status, RESULT_STATUS.FAILED);
});

test("recordCallbackResult: also advances job to completed when both resultId and jobId are present", async () => {
    const statusCalls = [];
    const { registry } = makeRegistry({
        updateJobStatus: async (id, status) => { statusCalls.push({ id, status }); },
    });

    await registry.recordCallbackResult({
        hookName:  "callback-received",
        serviceId: "svc-a",
        result:    { score: 42 },
        context:   { resultId: RESULT_UUID, jobId: JOB_UUID, serviceId: "svc-a" },
    });

    assert.equal(statusCalls.length, 1);
    assert.equal(statusCalls[0].id, JOB_UUID);
    assert.equal(statusCalls[0].status, JOB_STATUS.COMPLETED);
});

test("recordCallbackResult: advances job to failed when resultId and jobId present and result failed", async () => {
    const statusCalls = [];
    const { registry } = makeRegistry({
        updateJobStatus: async (id, status) => { statusCalls.push({ id, status }); },
    });

    await registry.recordCallbackResult({
        hookName:  "callback-received",
        serviceId: "svc-a",
        result:    { status: "failed" },
        context:   { resultId: RESULT_UUID, jobId: JOB_UUID },
    });

    assert.equal(statusCalls[0].status, JOB_STATUS.FAILED);
});

test("dispatchServiceHook: second callback with same eventId is duplicate — handler skipped", async () => {
    let handlerCallCount = 0;
    let callCount        = 0;

    const { registry } = makeRegistry({
        createResult: async () => {
            callCount++;
            if (callCount === 1) {
                return { id: RESULT_UUID, job_id: JOB_UUID, is_duplicate: false };
            }
            // Second call: same (serviceId, eventId) already recorded — createResult signals duplicate.
            return { id: `${RESULT_UUID}-2`, job_id: JOB_UUID, is_duplicate: true };
        },
    });

    registry.hookSubscribers.set("callback-received", [
        {
            serviceId: "svc-a",
            handler:   async (ctx, { callback }) => {
                handlerCallCount++;
                await callback({ score: 10 });
            },
        },
    ]);

    // First callback — should dispatch handler
    await registry.dispatchServiceHook("callback-received", "svc-a", { correlationId: JOB_UUID });

    // Second callback with same correlationId — job now terminal, should be a duplicate
    const { outcomes } = await registry.dispatchServiceHook("callback-received", "svc-a", { correlationId: JOB_UUID });

    assert.equal(handlerCallCount, 1, "handler must not run for duplicate callback");
    assert.deepEqual(outcomes, []);
});

test("recordCallbackResult: calls updateJobStatus when context has jobId only", async () => {
    const statusCalls = [];
    const { registry } = makeRegistry({
        updateJobStatus: async (id, status) => { statusCalls.push({ id, status }); },
    });

    await registry.recordCallbackResult({
        hookName:  "phase-started",
        serviceId: "svc-a",
        result:    { done: true },
        context:   { jobId: JOB_UUID },
    });

    assert.equal(statusCalls.length, 1);
    assert.equal(statusCalls[0].id, JOB_UUID);
    assert.equal(statusCalls[0].status, JOB_STATUS.COMPLETED);
});

test("recordCallbackResult: maps result.status 'failed' to JOB_STATUS.FAILED", async () => {
    const statusCalls = [];
    const { registry } = makeRegistry({
        updateJobStatus: async (id, status) => { statusCalls.push({ id, status }); },
    });

    await registry.recordCallbackResult({
        hookName:  "phase-started",
        serviceId: "svc-a",
        result:    { status: "failed" },
        context:   { jobId: JOB_UUID },
    });

    assert.equal(statusCalls[0].status, JOB_STATUS.FAILED);
});

test("recordCallbackResult: maps result.status 'skipped' to JOB_STATUS.SKIPPED", async () => {
    const statusCalls = [];
    const { registry } = makeRegistry({
        updateJobStatus: async (id, status) => { statusCalls.push({ id, status }); },
    });

    await registry.recordCallbackResult({
        hookName:  "phase-started",
        serviceId: "svc-a",
        result:    { status: "skipped" },
        context:   { jobId: JOB_UUID },
    });

    assert.equal(statusCalls[0].status, JOB_STATUS.SKIPPED);
});

test("recordCallbackResult: returns an entry with hookName, serviceId, and result", async () => {
    const { registry } = makeRegistry();

    const entry = await registry.recordCallbackResult({
        hookName:  "phase-started",
        serviceId: "svc-a",
        result:    { value: 1 },
        context:   { sessionId: 3, phaseId: 4 },
    });

    assert.ok(entry.id);
    assert.equal(entry.hookName,  "phase-started");
    assert.equal(entry.serviceId, "svc-a");
    assert.deepEqual(entry.result, { value: 1 });
});

// ─── globalHooks (manifest-level opt-in, #628) ───────────────────────────────

test("registerService: normalizes globalHooks (kebab-case, declared in hooks, de-duplicated)", async () => {
    const { registry } = makeRegistry();

    const { warnings } = await captureWarnings(() => registry.registerService({
        id:          "svc-global",
        adapter:     "./adapters/not-imported.adapter.js",
        hooks:       ["case-created", "callback-received"],
        globalHooks: ["case-created", "Bad Name", "phase-started", "case-created"],
        requires:    ["polyadic-agent"],
    }, "/nonexistent/manifest.json"));

    assert.deepEqual(registry.services.get("svc-global").globalHooks, ["case-created"]);
    assert.equal(warnings.length, 2, "one warning per dropped entry");
    assert.ok(warnings[0].includes("Bad Name"));
    assert.ok(warnings[1].includes("phase-started"));
});

test("registerService: globalHooks defaults to [] when absent", async () => {
    const { registry } = makeRegistry();

    await registry.registerService({
        id:       "svc-plain",
        adapter:  "./adapters/not-imported.adapter.js",
        hooks:    ["phase-started"],
        requires: ["polyadic-agent"],
    }, "/nonexistent/manifest.json");

    assert.deepEqual(registry.services.get("svc-plain").globalHooks, []);
});

test("listServices: exposes globalHooks and defaults it to [] for legacy entries", () => {
    const { registry } = makeRegistry();
    registry.services.set("svc-global", {
        id: "svc-global", development: true, hooks: ["case-created"], globalHooks: ["case-created"],
    });

    const listed = registry.listServices();
    assert.deepEqual(listed.find(s => s.id === "svc-global").globalHooks, ["case-created"]);
    assert.deepEqual(listed.find(s => s.id === "svc-a").globalHooks, []);
});

test("getUsableServiceIdsForGlobalHook: returns only usable services that list the hook", async () => {
    const { registry } = makeRegistry();
    registry.services.set("svc-global",   { id: "svc-global",   development: true,  globalHooks: ["case-created"] });
    registry.services.set("svc-disabled", { id: "svc-disabled", development: false, globalHooks: ["case-created"] });
    registry.services.set("svc-other",    { id: "svc-other",    development: true,  globalHooks: ["case-updated"] });

    assert.deepEqual(await registry.getUsableServiceIdsForGlobalHook("case-created"), ["svc-global"]);
    assert.deepEqual(await registry.getUsableServiceIdsForGlobalHook("unknown-hook"), []);
});

test("dispatchGlobalHook: invokes only usable global subscribers and enriches context", async () => {
    const calledBy = [];
    let capturedContext = null;
    const { registry } = makeRegistry();
    registry.services.set("svc-global", { id: "svc-global", development: true, globalHooks: ["case-created"] });

    registry.hookSubscribers.set("case-created", [
        { serviceId: "svc-global", handler: async (ctx) => { calledBy.push("svc-global"); capturedContext = ctx; } },
        { serviceId: "svc-a",      handler: async () => { calledBy.push("svc-a"); } },
    ]);

    const results = await registry.dispatchGlobalHook("case-created", { caseId: 99, userId: 7 });

    assert.deepEqual(calledBy, ["svc-global"]);
    assert.equal(results.length, 1);
    assert.equal(capturedContext.serviceId, "svc-global");
    assert.equal(capturedContext.jobId, JOB_UUID);
    assert.equal(capturedContext.correlationId, JOB_UUID);
    assert.deepEqual(capturedContext.enabledServiceIds, ["svc-global"]);
    assert.equal(capturedContext.caseId, 99);
});

test("dispatchGlobalHook: creates a job with null activity columns", async () => {
    const calls = [];
    const { registry } = makeRegistry({
        createJob: async (args) => { calls.push(args); return { id: JOB_UUID }; },
    });
    registry.services.set("svc-global", { id: "svc-global", development: true, globalHooks: ["case-created"] });
    registry.hookSubscribers.set("case-created", [
        { serviceId: "svc-global", handler: async () => {} },
    ]);

    await registry.dispatchGlobalHook("case-created", { caseId: 99, userId: 7 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].serviceId, "svc-global");
    assert.equal(calls[0].hookName, "case-created");
    assert.equal(calls[0].sessionId, null);
    assert.equal(calls[0].phaseId, null);
    assert.equal(calls[0].questionId, null);
    assert.equal(calls[0].groupId, null);
    assert.equal(calls[0].userId, 7);
});

test("dispatchGlobalHook: returns [] and creates no jobs when no service opted in", async () => {
    let createJobCalls = 0;
    const { registry } = makeRegistry({
        createJob: async () => { createJobCalls++; return { id: JOB_UUID }; },
    });
    registry.hookSubscribers.set("case-created", [
        { serviceId: "svc-a", handler: async () => {} },
    ]);

    const results = await registry.dispatchGlobalHook("case-created", { caseId: 1 });

    assert.deepEqual(results, []);
    assert.equal(createJobCalls, 0);
});

test("dispatchGlobalHook: isolates a throwing handler from other services", async () => {
    const statusCalls = [];
    let healthyCalled = false;
    const { registry } = makeRegistry({
        updateJobStatus: async (id, status) => { statusCalls.push({ id, status }); },
    });
    registry.services.set("svc-broken",  { id: "svc-broken",  development: true, globalHooks: ["case-created"] });
    registry.services.set("svc-healthy", { id: "svc-healthy", development: true, globalHooks: ["case-created"] });
    registry.hookSubscribers.set("case-created", [
        { serviceId: "svc-broken",  handler: async () => { throw new Error("adapter error"); } },
        { serviceId: "svc-healthy", handler: async () => { healthyCalled = true; } },
    ]);

    const results = await registry.dispatchGlobalHook("case-created", {});

    assert.equal(results.length, 2);
    assert.equal(results[0].status, "rejected");
    assert.equal(results[1].status, "fulfilled");
    assert.ok(healthyCalled);
    assert.equal(statusCalls.filter(c => c.status === JOB_STATUS.FAILED).length, 1);
});

test("dispatchHook: never consults globalHooks for activity hooks (regression)", async () => {
    let called = false;
    const { registry } = makeRegistry();
    registry.services.set("svc-global", { id: "svc-global", development: true, globalHooks: ["phase-started"] });
    registry.hookSubscribers.set("phase-started", [
        { serviceId: "svc-global", handler: async () => { called = true; } },
    ]);

    const results = await registry.dispatchHook("phase-started", { sessionId: 1, phaseId: 2 }, {
        enabledServiceIds: ["svc-a"],
    });

    assert.equal(called, false);
    assert.deepEqual(results, []);
});

// ─── scopes (where a service operates, #648) ─────────────────────────────────

test("registerService: keeps known scopes once and warns about each unknown one", async () => {
    const { registry } = makeRegistry();

    const { warnings } = await captureWarnings(() => registry.registerService({
        id:       "svc-scoped",
        adapter:  "./adapters/not-imported.adapter.js",
        hooks:    ["case-created"],
        scopes:   ["case", "Case", "chat", "case", 7],
        requires: ["polyadic-agent"],
    }, "/nonexistent/manifest.json"));

    assert.deepEqual(registry.services.get("svc-scoped").scopes, ["case", "chat"]);
    assert.equal(warnings.length, 2, "one warning per dropped entry");
    assert.ok(warnings[0].includes("\"Case\""));
    assert.ok(warnings[1].includes("\"7\""));
});

test("registerService: scopes defaults to [] when absent or not an array", async () => {
    const { registry } = makeRegistry();

    await registry.registerService({
        id:       "svc-plain",
        adapter:  "./adapters/not-imported.adapter.js",
        hooks:    ["phase-started"],
        requires: ["polyadic-agent"],
    }, "/nonexistent/manifest.json");
    await registry.registerService({
        id:       "svc-string",
        adapter:  "./adapters/not-imported.adapter.js",
        hooks:    ["case-created"],
        scopes:   "case",
        requires: ["polyadic-agent"],
    }, "/nonexistent/manifest.json");

    assert.deepEqual(registry.services.get("svc-plain").scopes, []);
    assert.deepEqual(registry.services.get("svc-string").scopes, []);
});

test("listServices: exposes scopes and defaults it to [] for legacy entries", () => {
    const { registry } = makeRegistry();
    registry.services.set("svc-scoped", {
        id: "svc-scoped", development: true, hooks: ["case-created"], scopes: ["case"],
    });

    const listed = registry.listServices();
    assert.deepEqual(listed.find(s => s.id === "svc-scoped").scopes, ["case"]);
    assert.deepEqual(listed.find(s => s.id === "svc-a").scopes, []);
});

// ─── descriptor (capability descriptor link, #725) ───────────────────────────

test("registerService: keeps a valid descriptor link", async () => {
    const { registry } = makeRegistry();

    await registry.registerService({
        id:         "svc-described",
        adapter:    "./adapters/not-imported.adapter.js",
        hooks:      ["phase-started"],
        descriptor: { path: " /polyadic-agent/api/capabilities " },
        requires:   ["polyadic-agent"],
    }, "/nonexistent/manifest.json");

    assert.deepEqual(registry.services.get("svc-described").descriptor, {
        serviceId: "polyadic-agent",
        path:      "/polyadic-agent/api/capabilities",
    });
});

test("registerService: descriptor is null when absent", async () => {
    const { registry } = makeRegistry();

    await registry.registerService({
        id:       "svc-plain",
        adapter:  "./adapters/not-imported.adapter.js",
        hooks:    ["phase-started"],
        requires: ["polyadic-agent"],
    }, "/nonexistent/manifest.json");

    assert.equal(registry.services.get("svc-plain").descriptor, null);
});

test("registerService: drops an invalid descriptor link with a warning", async () => {
    const invalid = [
        "polyadic-agent",
        {},
        { path: "" },
        { path: "x/api/capabilities" },
        { path: "https://evil.example/api/capabilities" },
        { path: "//evil.example/api/capabilities" },
        { path: "/x/../admin" },
        { path: "/x/api/capabilities?debug=1" },
        { path: "/x/api/capa bilities" },
    ];

    for (const descriptor of invalid) {
        const { registry } = makeRegistry();
        const { warnings } = await captureWarnings(() => registry.registerService({
            id:       "svc-invalid",
            adapter:  "./adapters/not-imported.adapter.js",
            hooks:    ["phase-started"],
            descriptor,
            requires: ["polyadic-agent"],
        }, "/nonexistent/manifest.json"));

        const label = JSON.stringify(descriptor);
        assert.equal(registry.services.get("svc-invalid").descriptor, null, label);
        assert.equal(warnings.length, 1, label);
        assert.ok(warnings[0].includes("svc-invalid"));
    }
});

test("listServices: exposes the descriptor id but not its route", () => {
    const { registry } = makeRegistry();
    registry.services.set("svc-described", {
        id:          "svc-described",
        development: true,
        hooks:       ["phase-started"],
        descriptor:  {
            serviceId: "argumentation-tutor",
            path:      "/argumentation-tutor/api/capabilities",
        },
    });

    const listed = registry.listServices();

    assert.deepEqual(
        listed.find(s => s.id === "svc-described").descriptor,
        { serviceId: "argumentation-tutor" },
    );
    assert.equal(listed.find(s => s.id === "svc-a").descriptor, null);
});

test("getServiceDescriptor: returns a copy of the link, or null", () => {
    const { registry } = makeRegistry();
    const descriptor = {
        serviceId: "argumentation-tutor",
        path:      "/argumentation-tutor/api/capabilities",
    };
    registry.services.set("svc-described", {
        id: "svc-described", development: true, hooks: [], descriptor,
    });

    const link = registry.getServiceDescriptor("svc-described");
    link.path = "/changed";

    assert.deepEqual(registry.getServiceDescriptor("svc-described"), descriptor);
    assert.equal(registry.getServiceDescriptor("svc-a"), null);
    assert.equal(registry.getServiceDescriptor("unknown"), null);
});

// ─── getServiceInstanceConfiguration (capability descriptors, #727) ──────────

function makeDescriptorsStub(result) {
    const calls = [];
    return {
        calls,
        getInstanceConfiguration: async (serviceId, locale) => {
            calls.push({ serviceId, locale });
            return result;
        },
    };
}

test("getServiceInstanceConfiguration: delegates usable services to the descriptor client", async () => {
    const descriptors = makeDescriptorsStub({ available: true, fields: [] });
    const registry = new ExternalServicesRegistry({
        jobsService:           makeJobsServiceStub(),
        capabilityDescriptors: descriptors,
        developmentAdapters:   true,
    });
    registry.services.set("svc-described", { id: "svc-described", development: true });

    const configuration = await registry.getServiceInstanceConfiguration("svc-described", "es_CL");

    assert.deepEqual(configuration, { available: true, fields: [] });
    assert.deepEqual(descriptors.calls, [{ serviceId: "svc-described", locale: "es_CL" }]);
});

test("getServiceInstanceConfiguration: null for unknown and unusable services", async () => {
    const descriptors = makeDescriptorsStub({ available: true, fields: [] });
    const registry = new ExternalServicesRegistry({
        jobsService:           makeJobsServiceStub(),
        capabilityDescriptors: descriptors,
        aiServicePolicy:       {
            getCurrentPolicyVersion: async () => ({ id: 1, allowedServiceIds: [] }),
        },
        isAiAdditionsConfigured: async () => true,
    });
    registry.services.set("svc-off", { id: "svc-off", development: false, requires: ["case-analyst"] });

    assert.equal(await registry.getServiceInstanceConfiguration("svc-off", "en_US"), null);
    assert.equal(await registry.getServiceInstanceConfiguration("unknown", "en_US"), null);
    assert.equal(descriptors.calls.length, 0);
});

test("getServiceInstanceConfiguration: the default client follows the manifest link", async () => {
    const { registry } = makeRegistry();

    assert.equal(await registry.getServiceInstanceConfiguration("svc-a", "en_US"), null,
        "a service without a descriptor link has no instance configuration");
});

// ─── capabilities (removed in favor of the response scope, #726) ─────────────

test("registerService: ignores the deprecated capabilities key with one warning", async () => {
    const { registry } = makeRegistry();

    const { warnings } = await captureWarnings(() => registry.registerService({
        id:           "svc-legacy",
        adapter:      "./adapters/not-imported.adapter.js",
        hooks:        ["student-response-submitted"],
        scopes:       ["response"],
        capabilities: { processesStudentResponses: true },
        requires:     ["polyadic-agent"],
    }, "/nonexistent/manifest.json"));

    assert.equal(Object.hasOwn(registry.services.get("svc-legacy"), "capabilities"), false);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("svc-legacy"));
    assert.ok(warnings[0].includes("capabilities"));
});

test("registerService: no capabilities warning when the key is absent", async () => {
    const { registry } = makeRegistry();

    const { warnings } = await captureWarnings(() => registry.registerService({
        id:       "svc-current",
        adapter:  "./adapters/not-imported.adapter.js",
        hooks:    ["student-response-submitted"],
        scopes:   ["response"],
        requires: ["polyadic-agent"],
    }, "/nonexistent/manifest.json"));

    assert.deepEqual(warnings, []);
});

// ─── serviceConfiguration (per-phase settings, #734) ─────────────────────────

function captureContexts(registry, hookName, serviceIds) {
    const contexts = {};
    registry.hookSubscribers.set(hookName, serviceIds.map(serviceId => ({
        serviceId,
        handler: async (ctx) => { contexts[serviceId] = ctx; },
    })));
    return contexts;
}

test("dispatchHook: each handler receives its own serviceConfiguration", async () => {
    const { registry } = makeRegistry();
    registry.services.set("svc-b", { id: "svc-b", development: true });
    const contexts = captureContexts(registry, "phase-started", ["svc-a", "svc-b"]);
    const serviceConfigurations = { "svc-a": { llm_tier: "advanced" } };

    await registry.dispatchHook("phase-started", { sessionId: 1, phaseId: 2 }, {
        enabledServiceIds: ["svc-a", "svc-b"],
        serviceConfigurations,
    });

    assert.deepEqual(contexts["svc-a"].serviceConfiguration, { llm_tier: "advanced" });
    assert.deepEqual(contexts["svc-b"].serviceConfiguration, {}, "no stored configuration");

    contexts["svc-a"].serviceConfiguration.llm_tier = "basic";
    assert.equal(serviceConfigurations["svc-a"].llm_tier, "advanced", "handlers get a copy");
});

test("dispatchHook: serviceConfiguration is {} when absent or not an object", async () => {
    const { registry } = makeRegistry();
    const contexts = captureContexts(registry, "phase-started", ["svc-a"]);

    await registry.dispatchHook("phase-started", {}, { enabledServiceIds: ["svc-a"] });
    assert.deepEqual(contexts["svc-a"].serviceConfiguration, {});

    await registry.dispatchHook("phase-started", {}, {
        enabledServiceIds:     ["svc-a"],
        serviceConfigurations: { "svc-a": ["not", "an", "object"] },
    });
    assert.deepEqual(contexts["svc-a"].serviceConfiguration, {});
});

test("dispatchGlobalHook: hooks without a phase get an empty serviceConfiguration", async () => {
    const { registry } = makeRegistry();
    registry.services.set("svc-a", { id: "svc-a", development: true, globalHooks: ["case-created"] });
    const contexts = captureContexts(registry, "case-created", ["svc-a"]);

    await registry.dispatchGlobalHook("case-created", { caseId: 9 });

    assert.deepEqual(contexts["svc-a"].serviceConfiguration, {});
});

test("dispatchServiceHook: callbacks get an empty serviceConfiguration", async () => {
    const { registry } = makeRegistry();
    const contexts = captureContexts(registry, "callback-received", ["svc-a"]);

    await registry.dispatchServiceHook("callback-received", "svc-a", { phaseId: 2 });

    assert.deepEqual(contexts["svc-a"].serviceConfiguration, {});
});

// ─── reportInstantiation (#737) ──────────────────────────────────────────────

function registryWithReports() {
    const stored = [];
    const statuses = [];
    const { registry } = makeRegistry({
        recordInstantiationReport: async (jobId, report) => { stored.push({ jobId, report }); },
        updateJobStatus:           async (jobId, status) => { statuses.push(status); },
    });
    return { registry, stored, statuses };
}

test("dispatchHook: handlers can store an instantiation report on their job", async () => {
    const { registry, stored, statuses } = registryWithReports();
    const warning = { field: "model", verdict: "deprecated", suggested_field: "llm_tier" };
    registry.hookSubscribers.set("phase-started", [{
        serviceId: "svc-a",
        handler:   async (ctx, { reportInstantiation }) => {
            await reportInstantiation({ warnings: [warning], rooms: [{ room: "r1" }] });
        },
    }]);

    const { warnings } = await captureWarnings(() =>
        registry.dispatchHook("phase-started", { sessionId: 1, phaseId: 2 }, {
            enabledServiceIds: ["svc-a"],
        }));

    assert.deepEqual(stored, [{
        jobId:  JOB_UUID,
        report: {
            warnings:              [warning],
            degraded:              false,
            configurationRejected: false,
            rooms:                 [{ room: "r1" }],
        },
    }]);
    assert.deepEqual(statuses, [JOB_STATUS.DISPATCHED], "the job status is unchanged");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Instantiation report/u);
    assert.match(warnings[0], /"serviceId":"svc-a"/u);
});

test("dispatchHook: a stored instantiation report is announced to the session's teachers (#865)", async () => {
    const { registry } = registryWithReports();
    const announced = [];
    registry._notifyServiceInstantiated = (sessionId, payload) => announced.push({ sessionId, payload });
    registry.hookSubscribers.set("student-response-submitted", [{
        serviceId: "svc-a",
        handler:   async (ctx, { reportInstantiation }) => {
            await reportInstantiation({ tutorMode: "basic", tutorModeReason: "no-inventory" });
        },
    }]);

    await registry.dispatchHook("student-response-submitted", { sessionId: 1, phaseId: 2, questionId: 3 }, {
        enabledServiceIds: ["svc-a"],
    });

    assert.deepEqual(announced, [{
        sessionId: 1,
        payload:   { serviceId: "svc-a", sessionId: 1, phaseId: 2, questionId: 3 },
    }]);
});

test("recordInstantiationReport: a report that could not be stored is not announced", async () => {
    const { registry } = makeRegistry({
        recordInstantiationReport: async () => { throw new Error("db down"); },
    });
    const announced = [];
    registry._notifyServiceInstantiated = (sessionId, payload) => announced.push({ sessionId, payload });
    const originalError = console.error;
    console.error = () => {};
    try {
        await registry.recordInstantiationReport({
            hookName:  "student-response-submitted",
            serviceId: "svc-a",
            jobId:     JOB_UUID,
            report:    { tutorMode: "basic" },
            context:   { sessionId: 1, phaseId: 2 },
        });
    } finally {
        console.error = originalError;
    }

    assert.deepEqual(announced, []);
});

test("recordInstantiationReport: clean reports are stored without a log line", async () => {
    const { registry, stored } = registryWithReports();

    const { warnings } = await captureWarnings(() => registry.recordInstantiationReport({
        hookName:  "phase-started",
        serviceId: "svc-a",
        jobId:     JOB_UUID,
        report:    { warnings: [], degraded: false, llmTier: "advanced" },
    }));

    assert.equal(stored.length, 1);
    assert.equal(stored[0].report.llmTier, "advanced");
    assert.deepEqual(warnings, []);
});

test("recordInstantiationReport: degraded or rejected settings are logged", async () => {
    const { registry } = registryWithReports();

    for (const report of [{ degraded: true }, { configurationRejected: true }]) {
        const { warnings } = await captureWarnings(() => registry.recordInstantiationReport({
            hookName: "phase-started", serviceId: "svc-a", jobId: JOB_UUID, report,
        }));
        assert.equal(warnings.length, 1, JSON.stringify(report));
    }
});

test("recordInstantiationReport: nothing to store without a report or a job", async () => {
    const { registry, stored } = registryWithReports();

    for (const report of [undefined, null, "warnings", ["x"]]) {
        assert.equal(await registry.recordInstantiationReport({
            hookName: "phase-started", serviceId: "svc-a", jobId: JOB_UUID, report,
        }), null);
    }
    await captureWarnings(() => registry.recordInstantiationReport({
        hookName: "phase-started", serviceId: "svc-a", jobId: null, report: { degraded: true },
    }));

    assert.deepEqual(stored, []);
});


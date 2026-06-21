import assert from "node:assert/strict";
import test from "node:test";
import { ExternalServicesRegistry } from "../external-services.service.js";
import { JOB_STATUS, RESULT_STATUS } from "../external-service-jobs.service.js";

const JOB_UUID    = "b1c2d3e4-0000-4000-8000-000000000011";
const RESULT_UUID = "b1c2d3e4-0000-4000-8000-000000000012";

function makeJobsServiceStub(overrides = {}) {
    return {
        createJob:               async () => ({ id: JOB_UUID }),
        updateJobStatus:         async () => {},
        createResult:            async () => ({ id: RESULT_UUID, job_id: JOB_UUID }),
        updateResult:            async () => {},
        recordProviderReference: async () => {},
        ...overrides,
    };
}

function makeRegistry(jobsServiceOverrides = {}) {
    const jobsService = makeJobsServiceStub(jobsServiceOverrides);
    const registry = new ExternalServicesRegistry({ jobsService });
    registry.initialized = true;
    registry.services.set("svc-a", { id: "svc-a", enabled: true });
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
            return { id: RESULT_UUID, job_id: null };
        },
    });

    registry.hookSubscribers.set("callback-received", [
        { serviceId: "svc-a", handler: async () => {} },
    ]);

    await registry.dispatchServiceHook(
        "callback-received",
        "svc-a",
        { rawBody: { raw: true } }
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

test("recordCallbackResult: appends entry to in-memory results list", async () => {
    const { registry } = makeRegistry();

    const entry = await registry.recordCallbackResult({
        hookName:  "phase-started",
        serviceId: "svc-a",
        result:    { value: 1 },
        context:   { sessionId: 3, phaseId: 4 },
    });

    assert.ok(entry.id);
    assert.equal(entry.hookName, "phase-started");
    assert.equal(entry.serviceId, "svc-a");
    assert.deepEqual(entry.result, { value: 1 });
    assert.equal(registry.results.length, 1);
    assert.equal(registry.results[0], entry);
});

test("recordCallbackResult: caps in-memory list at 100 entries", async () => {
    const { registry } = makeRegistry();

    for (let i = 0; i < 101; i++) {
        await registry.recordCallbackResult({
            hookName:  "h",
            serviceId: "svc-a",
            result:    {},
            context:   {},
        });
    }

    assert.equal(registry.results.length, 100);
});

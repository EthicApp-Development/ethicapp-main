import assert from "node:assert/strict";
import test from "node:test";
import { processCallback, listJobs, getJobDetail, listResults } from "../external-services.js";

const JOB_UUID    = "c1d2e3f4-0000-4000-8000-000000000021";
const RESULT_UUID = "c1d2e3f4-0000-4000-8000-000000000022";

function makeRegistry(overrides = {}) {
    return {
        initialize:              async () => {},
        authorizeCallbackCaller: () => {},
        dispatchServiceHook:     async () => ({
            resultRecord: { id: RESULT_UUID, job_id: JOB_UUID, is_duplicate: false },
            outcomes:     [{ status: "fulfilled", value: undefined }],
        }),
        ...overrides,
    };
}

// ─── input validation ─────────────────────────────────────────────────────────

test("processCallback: 400 when serviceId is absent", async () => {
    const { status, body } = await processCallback({
        serviceId:     "",
        eventType:     "result",
        correlationId: null,
        payload:       null,
        auth:          {},
        registry:      makeRegistry(),
    });

    assert.equal(status, 400);
    assert.equal(body.status, "err");
});

// ─── authorization ────────────────────────────────────────────────────────────

test("processCallback: 403 when authorizeCallbackCaller throws", async () => {
    const err = new Error("Not authorized");
    err.statusCode = 403;

    const { status, body } = await processCallback({
        serviceId: "svc-a",
        eventType: "result",
        auth:      {},
        registry:  makeRegistry({
            authorizeCallbackCaller: () => { throw err; },
        }),
    });

    assert.equal(status, 403);
    assert.equal(body.status, "err");
});

// ─── valid correlation ────────────────────────────────────────────────────────

test("processCallback: 202 with correlationStatus 'matched' for known correlationId", async () => {
    const { status, body } = await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: JOB_UUID,
        payload:       { score: 10 },
        auth:          {},
        registry:      makeRegistry(),
    });

    assert.equal(status, 202);
    assert.equal(body.result.correlationStatus, "matched");
    assert.equal(body.result.resultId,          RESULT_UUID);
    assert.equal(body.result.isDuplicate,        false);
    assert.equal(body.result.correlationId,     JOB_UUID);
    assert.equal(body.result.dispatched,         1);
});

// ─── missing / unknown correlation ────────────────────────────────────────────

test("processCallback: 202 with correlationStatus 'unknown' for missing correlationId", async () => {
    const { status, body } = await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: null,
        payload:       {},
        auth:          {},
        registry:      makeRegistry({
            dispatchServiceHook: async () => ({
                resultRecord: { id: RESULT_UUID, job_id: null, is_duplicate: false },
                outcomes:     [],
            }),
        }),
    });

    assert.equal(status, 202);
    assert.equal(body.result.correlationStatus, "unknown");
    assert.equal(body.result.resultId,          RESULT_UUID);
});

test("processCallback: 202 with correlationStatus 'unknown' for unrecognized correlationId", async () => {
    const { status, body } = await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: "aaaaaaaa-0000-0000-0000-000000000000",
        payload:       {},
        auth:          {},
        registry:      makeRegistry({
            dispatchServiceHook: async () => ({
                resultRecord: { id: RESULT_UUID, job_id: null, is_duplicate: false },
                outcomes:     [],
            }),
        }),
    });

    assert.equal(status, 202);
    assert.equal(body.result.correlationStatus, "unknown");
});

// ─── eventId handling ─────────────────────────────────────────────────────────

const EVENT_UUID = "e1e2e3e4-0000-4000-8000-000000000099";

test("processCallback: echoes eventId in response when provided", async () => {
    const { status, body } = await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: JOB_UUID,
        eventId:       EVENT_UUID,
        payload:       {},
        auth:          {},
        registry:      makeRegistry(),
    });

    assert.equal(status, 202);
    assert.equal(body.result.eventId, EVENT_UUID);
});

test("processCallback: eventId null in response when not provided", async () => {
    const { status, body } = await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: JOB_UUID,
        payload:       {},
        auth:          {},
        registry:      makeRegistry(),
    });

    assert.equal(status, 202);
    assert.equal(body.result.eventId, null);
});

test("processCallback: 400 when eventId is not a valid UUID", async () => {
    const { status, body } = await processCallback({
        serviceId: "svc-a",
        eventType: "result",
        eventId:   "not-a-uuid",
        auth:      {},
        registry:  makeRegistry(),
    });

    assert.equal(status, 400);
    assert.equal(body.status, "err");
});

test("processCallback: forwards eventId through context to dispatchServiceHook", async () => {
    let capturedCtx = null;

    await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: JOB_UUID,
        eventId:       EVENT_UUID,
        payload:       {},
        auth:          {},
        registry:      makeRegistry({
            dispatchServiceHook: async (_hook, _svc, ctx) => {
                capturedCtx = ctx;
                return {
                    resultRecord: { id: RESULT_UUID, job_id: JOB_UUID, is_duplicate: false },
                    outcomes:     [],
                };
            },
        }),
    });

    assert.equal(capturedCtx?.eventId, EVENT_UUID);
});

// ─── duplicate callback ───────────────────────────────────────────────────────

test("processCallback: 202 with isDuplicate true and dispatched 0 for completed job", async () => {
    const { status, body } = await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: JOB_UUID,
        payload:       {},
        auth:          {},
        registry:      makeRegistry({
            dispatchServiceHook: async () => ({
                resultRecord: { id: RESULT_UUID, job_id: JOB_UUID, is_duplicate: true },
                outcomes:     [],
            }),
        }),
    });

    assert.equal(status, 202);
    assert.equal(body.result.correlationStatus, "matched");
    assert.equal(body.result.isDuplicate,        true);
    assert.equal(body.result.dispatched,         0);
});

// ─── adapter failure / skipped ────────────────────────────────────────────────

test("processCallback: 202 even when all adapter handlers are rejected", async () => {
    const { status, body } = await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: JOB_UUID,
        payload:       {},
        auth:          {},
        registry:      makeRegistry({
            dispatchServiceHook: async () => ({
                resultRecord: { id: RESULT_UUID, job_id: JOB_UUID, is_duplicate: false },
                outcomes:     [{ status: "rejected", reason: new Error("adapter error") }],
            }),
        }),
    });

    assert.equal(status, 202);
    assert.equal(body.result.dispatched, 1);
});

test("processCallback: 202 with dispatched 0 when no subscribers match", async () => {
    const { status, body } = await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: null,
        payload:       {},
        auth:          {},
        registry:      makeRegistry({
            dispatchServiceHook: async () => ({
                resultRecord: { id: RESULT_UUID, job_id: null, is_duplicate: false },
                outcomes:     [],
            }),
        }),
    });

    assert.equal(status, 202);
    assert.equal(body.result.dispatched, 0);
});

test("processCallback: passes rawBody to registry when payload is null", async () => {
    let capturedCtx = null;
    const rawBody = { serviceId: "svc-a", eventType: "result", nested: { x: 1 } };

    await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: null,
        payload:       null,
        rawBody,
        auth:          {},
        registry:      makeRegistry({
            dispatchServiceHook: async (_hook, _svc, ctx) => {
                capturedCtx = ctx;
                return {
                    resultRecord: { id: RESULT_UUID, job_id: null, is_duplicate: false },
                    outcomes:     [],
                };
            },
        }),
    });

    assert.deepEqual(capturedCtx?.rawBody, rawBody);
});

// ─── internal error ───────────────────────────────────────────────────────────

test("processCallback: 500 on unexpected dispatchServiceHook error", async () => {
    const { status, body } = await processCallback({
        serviceId: "svc-a",
        eventType: "result",
        auth:      {},
        registry:  makeRegistry({
            dispatchServiceHook: async () => { throw new Error("unexpected"); },
        }),
    });

    assert.equal(status, 500);
    assert.equal(body.status, "err");
});

// ─── listJobs ─────────────────────────────────────────────────────────────────

const JOBS_FIXTURE = [
    { id: JOB_UUID, service_id: "svc-a", hook_name: "phase-started", status: "completed" },
];

function makeJobsService(overrides = {}) {
    return {
        queryRecentJobs:  async () => JOBS_FIXTURE,
        queryRecentResults: async () => [],
        getJob:           async () => null,
        getJobResults:    async () => [],
        ...overrides,
    };
}

test("listJobs: 200 with jobs array from service", async () => {
    const { status, body } = await listJobs({}, makeJobsService());

    assert.equal(status, 200);
    assert.equal(body.status, "ok");
    assert.deepEqual(body.result, JOBS_FIXTURE);
});

test("listJobs: passes serviceId, sessionId, phaseId, status filters to service", async () => {
    let capturedParams = null;
    const svc = makeJobsService({
        queryRecentJobs: async params => { capturedParams = params; return []; },
    });

    await listJobs({
        serviceId: "svc-a",
        sessionId: "10",
        phaseId:   "20",
        status:    "completed",
    }, svc);

    assert.equal(capturedParams.serviceId, "svc-a");
    assert.equal(capturedParams.sessionId, 10);
    assert.equal(capturedParams.phaseId,   20);
    assert.equal(capturedParams.status,    "completed");
});

test("listJobs: passes from and to date filters to service", async () => {
    let capturedParams = null;
    const svc = makeJobsService({
        queryRecentJobs: async params => { capturedParams = params; return []; },
    });

    await listJobs({ from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" }, svc);

    assert.ok(capturedParams.from);
    assert.ok(capturedParams.to);
});

test("listJobs: invalid sessionId is passed as null", async () => {
    let capturedParams = null;
    const svc = makeJobsService({
        queryRecentJobs: async params => { capturedParams = params; return []; },
    });

    await listJobs({ sessionId: "not-a-number" }, svc);

    assert.equal(capturedParams.sessionId, null);
});

// ─── getJobDetail ─────────────────────────────────────────────────────────────

const RESULTS_FIXTURE = [
    { id: RESULT_UUID, job_id: JOB_UUID, status: "completed" },
];

test("getJobDetail: 200 with job and results when job exists", async () => {
    const svc = makeJobsService({
        getJob:        async () => JOBS_FIXTURE[0],
        getJobResults: async () => RESULTS_FIXTURE,
    });

    const { status, body } = await getJobDetail(JOB_UUID, svc);

    assert.equal(status, 200);
    assert.deepEqual(body.result.job,     JOBS_FIXTURE[0]);
    assert.deepEqual(body.result.results, RESULTS_FIXTURE);
});

test("getJobDetail: 404 when job does not exist", async () => {
    const { status, body } = await getJobDetail(JOB_UUID, makeJobsService());

    assert.equal(status, 404);
    assert.equal(body.status, "err");
});

test("getJobDetail: 400 for non-UUID job id", async () => {
    const { status, body } = await getJobDetail("not-a-uuid", makeJobsService());

    assert.equal(status, 400);
    assert.equal(body.status, "err");
});

test("getJobDetail: 400 for missing job id", async () => {
    const { status, body } = await getJobDetail(undefined, makeJobsService());

    assert.equal(status, 400);
    assert.equal(body.status, "err");
});

// ─── listResults ─────────────────────────────────────────────────────────────

const RESULTS_LIST_FIXTURE = [
    { id: RESULT_UUID, job_id: JOB_UUID, service_id: "svc-a", status: "completed" },
];

test("listResults: 200 with results array from service", async () => {
    const svc = makeJobsService({
        queryRecentResults: async () => RESULTS_LIST_FIXTURE,
    });

    const { status, body } = await listResults({}, svc);

    assert.equal(status, 200);
    assert.equal(body.status, "ok");
    assert.deepEqual(body.result, RESULTS_LIST_FIXTURE);
});

test("listResults: passes serviceId, sessionId, phaseId, status filters to service", async () => {
    let capturedParams = null;
    const svc = makeJobsService({
        queryRecentResults: async params => { capturedParams = params; return []; },
    });

    await listResults({
        serviceId: "svc-a",
        sessionId: "5",
        phaseId:   "3",
        status:    "callback-received",
    }, svc);

    assert.equal(capturedParams.serviceId, "svc-a");
    assert.equal(capturedParams.sessionId, 5);
    assert.equal(capturedParams.phaseId,   3);
    assert.equal(capturedParams.status,    "callback-received");
});

test("listResults: passes from and to date filters to service", async () => {
    let capturedParams = null;
    const svc = makeJobsService({
        queryRecentResults: async params => { capturedParams = params; return []; },
    });

    await listResults({ from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" }, svc);

    assert.ok(capturedParams.from);
    assert.ok(capturedParams.to);
});

test("listResults: empty string serviceId treated as null", async () => {
    let capturedParams = null;
    const svc = makeJobsService({
        queryRecentResults: async params => { capturedParams = params; return []; },
    });

    await listResults({ serviceId: "   " }, svc);

    assert.equal(capturedParams.serviceId, null);
});

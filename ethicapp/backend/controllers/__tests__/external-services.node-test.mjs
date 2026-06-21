import assert from "node:assert/strict";
import test from "node:test";
import { processCallback } from "../external-services.js";

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

// ─── duplicate callback ───────────────────────────────────────────────────────

test("processCallback: 202 with isDuplicate true for already-completed job", async () => {
    const { status, body } = await processCallback({
        serviceId:     "svc-a",
        eventType:     "result",
        correlationId: JOB_UUID,
        payload:       {},
        auth:          {},
        registry:      makeRegistry({
            dispatchServiceHook: async () => ({
                resultRecord: { id: RESULT_UUID, job_id: JOB_UUID, is_duplicate: true },
                outcomes:     [{ status: "fulfilled", value: undefined }],
            }),
        }),
    });

    assert.equal(status, 202);
    assert.equal(body.result.correlationStatus, "matched");
    assert.equal(body.result.isDuplicate,        true);
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

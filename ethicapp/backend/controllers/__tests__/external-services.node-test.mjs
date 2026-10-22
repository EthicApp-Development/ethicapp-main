import assert from "node:assert/strict";
import test from "node:test";
import { listExternalServices, processCallback } from "../external-services.js";

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

// ─── listExternalServices ────────────────────────────────────────────────────

function makeListingRegistry() {
    return {
        initialize:               async () => {},
        getServiceUiTranslations: async () => null,
        listServices:             () => [
            { id: "case-tool",     enabled: true,  scopes: ["case"] },
            { id: "chat-tool",     enabled: true,  scopes: ["chat"] },
            { id: "review-tool",   enabled: true,  scopes: ["response", "chat"] },
            { id: "disabled-case", enabled: false, scopes: ["case"] },
            { id: "unscoped",      enabled: true,  scopes: [] },
        ],
    };
}

function listedIds(body) {
    return body.result.map(({ id }) => id);
}

test("listExternalServices: no scope lists every service, disabled ones included", async () => {
    const { status, body } = await listExternalServices({
        scope:    undefined,
        registry: makeListingRegistry(),
    });

    assert.equal(status, 200);
    assert.deepEqual(listedIds(body), [
        "case-tool", "chat-tool", "review-tool", "disabled-case", "unscoped",
    ]);
});

test("listExternalServices: a scope lists only the enabled services that declare it", async () => {
    const { status, body } = await listExternalServices({
        scope:    "case",
        registry: makeListingRegistry(),
    });

    assert.equal(status, 200);
    assert.deepEqual(listedIds(body), ["case-tool"]);
});

test("listExternalServices: several scopes list each matching service once", async () => {
    const { status, body } = await listExternalServices({
        scope:    ["response", "chat"],
        registry: makeListingRegistry(),
    });

    assert.equal(status, 200);
    assert.deepEqual(listedIds(body), ["chat-tool", "review-tool"]);
});

test("listExternalServices: 400 when any scope is unknown or empty", async () => {
    for (const scope of ["cases", "", ["case", "bogus"]]) {
        const { status, body } = await listExternalServices({
            scope,
            registry: makeListingRegistry(),
        });

        assert.equal(status, 400, `scope ${JSON.stringify(scope)}`);
        assert.equal(body.status, "err");
    }
});

test("listExternalServices: each listed service carries its UI translations or null", async () => {
    const translations = {
        es_CL: { label: "Case tool (es_CL)", description: "Analyses the case (es_CL)." },
        en_US: { label: "Case tool", description: "Analyses the case." },
    };
    const registry = {
        ...makeListingRegistry(),
        listServices: () => [
            { id: "case-tool", enabled: true, scopes: ["case"], ui: { component: "tool-panel" } },
            { id: "chat-tool", enabled: true, scopes: ["chat"], ui: { component: null } },
        ],
        getServiceUiTranslations: async id => (id === "case-tool" ? translations : null),
    };

    const { body } = await listExternalServices({ scope: undefined, registry });

    assert.deepEqual(body.result.map(({ id, ui }) => ({ id, ui })), [
        { id: "case-tool", ui: { component: "tool-panel", translations } },
        { id: "chat-tool", ui: { component: null, translations: null } },
    ]);
});

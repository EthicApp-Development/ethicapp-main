import assert from "node:assert/strict";
import test from "node:test";
import {
    getExternalServiceInstanceConfiguration,
    listExternalServices,
    processCallback,
    resolveTeacherLocale,
} from "../external-services.js";

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
            { id: "case-tool",     usable: true,  scopes: ["case"] },
            { id: "chat-tool",     usable: true,  scopes: ["chat"] },
            { id: "review-tool",   usable: true,  scopes: ["response", "chat"] },
            { id: "unusable-case", usable: false, scopes: ["case"] },
            { id: "unscoped",      usable: true,  scopes: [] },
        ],
    };
}

function listedIds(body) {
    return body.result.map(({ id }) => id);
}

test("listExternalServices: no scope lists every usable service and no other one", async () => {
    const { status, body } = await listExternalServices({
        scope:    undefined,
        registry: makeListingRegistry(),
    });

    assert.equal(status, 200);
    assert.deepEqual(listedIds(body), ["case-tool", "chat-tool", "review-tool", "unscoped"]);
});

test("listExternalServices: an empty list when no service is usable", async () => {
    const registry = {
        ...makeListingRegistry(),
        listServices: () => [
            { id: "chat-tool",   usable: false, scopes: ["chat"] },
            { id: "review-tool", usable: false, scopes: ["response", "chat"] },
        ],
    };

    for (const scope of [undefined, ["response", "chat"]]) {
        const { status, body } = await listExternalServices({ scope, registry });

        assert.equal(status, 200);
        assert.deepEqual(body.result, [], `scope ${JSON.stringify(scope)}`);
    }
});

test("listExternalServices: a scope lists only the usable services that declare it", async () => {
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
            { id: "case-tool", usable: true, scopes: ["case"], ui: { component: "tool-panel" } },
            { id: "chat-tool", usable: true, scopes: ["chat"], ui: { component: null } },
        ],
        getServiceUiTranslations: async id => (id === "case-tool" ? translations : null),
    };

    const { body } = await listExternalServices({ scope: undefined, registry });

    assert.deepEqual(body.result.map(({ id, ui }) => ({ id, ui })), [
        { id: "case-tool", ui: { component: "tool-panel", translations } },
        { id: "chat-tool", ui: { component: null, translations: null } },
    ]);
});

// ─── descriptor summary and instance configuration (#728) ────────────────────

const BASIC_ENTRY = Object.freeze({
    value: "basic", label: "Basic", status: "active", supersededBy: null,
});

const FIELDS = Object.freeze([{
    key:          "llm_tier",
    type:         "enum",
    required:     false,
    default:      "basic",
    label:        "Language Model Tier",
    description:  null,
    group:        null,
    order:        1,
    status:       "active",
    supersededBy: null,
    validation:   { entries: [BASIC_ENTRY] },
}]);

const UNAVAILABLE = Object.freeze({ available: false, reason: "unreachable" });

function availableConfiguration(overrides = {}) {
    return {
        available:           true,
        stale:               false,
        descriptorServiceId: "polyadic-agent",
        name:                "Polyadic Agents",
        usesLlm:             true,
        locale:              "es-CL",
        fields:              FIELDS,
        ...overrides,
    };
}

function describedService(id, descriptorServiceId) {
    return {
        id,
        usable:     true,
        scopes:     ["chat"],
        descriptor: descriptorServiceId ? { serviceId: descriptorServiceId } : null,
    };
}

function makeDescribedRegistry(configurations) {
    const calls = [];
    return {
        calls,
        initialize:                      async () => {},
        getServiceUiTranslations:        async () => null,
        getServiceInstanceConfiguration: async (serviceId, locale) => {
            calls.push({ serviceId, locale });
            return configurations[serviceId] ?? null;
        },
        listServices: () => [
            describedService("described-up", "polyadic-agent"),
            describedService("described-down", "argumentation-tutor"),
            describedService("plain", null),
        ],
    };
}

function getConfiguration(registry, serviceId, locale) {
    return getExternalServiceInstanceConfiguration({ serviceId, registry, locale });
}

test("listExternalServices: summarizes descriptors in the teacher's locale", async () => {
    const registry = makeDescribedRegistry({
        "described-up":   availableConfiguration(),
        "described-down": UNAVAILABLE,
    });

    const { status, body } = await listExternalServices({
        scope:  "chat",
        registry,
        locale: "es_CL",
    });

    assert.equal(status, 200);
    assert.deepEqual(body.result.map(({ id, descriptor }) => ({ id, descriptor })), [
        {
            id:         "described-up",
            descriptor: {
                serviceId: "polyadic-agent",
                available: true,
                name:      "Polyadic Agents",
                usesLlm:   true,
            },
        },
        {
            id:         "described-down",
            descriptor: {
                serviceId: "argumentation-tutor",
                available: false,
                name:      null,
                usesLlm:   null,
            },
        },
        { id: "plain", descriptor: null },
    ]);
    assert.deepEqual(registry.calls, [
        { serviceId: "described-up", locale: "es_CL" },
        { serviceId: "described-down", locale: "es_CL" },
    ]);
});

test("listExternalServices: the summary leaks no descriptor internals", async () => {
    const registry = makeDescribedRegistry({
        "described-up": availableConfiguration({ path: "/polyadic-agent/api/capabilities" }),
    });

    const { body } = await listExternalServices({ scope: "chat", registry, locale: "en_US" });
    const serialized = JSON.stringify(body);

    assert.equal(serialized.includes("/api/capabilities"), false);
    assert.equal(serialized.includes("llm_tier"), false, "fields come only from the endpoint");
});

test("instance configuration: returns the fields of an available descriptor", async () => {
    const registry = makeDescribedRegistry({ "described-up": availableConfiguration() });

    const { status, body } = await getConfiguration(registry, "described-up", "es_CL");

    assert.equal(status, 200);
    assert.deepEqual(body, {
        status: "ok",
        result: {
            serviceId: "described-up",
            available: true,
            stale:     false,
            name:      "Polyadic Agents",
            usesLlm:   true,
            locale:    "es_CL",
            fields:    FIELDS,
        },
    });
    assert.deepEqual(registry.calls, [{ serviceId: "described-up", locale: "es_CL" }]);
});

test("instance configuration: keeps internals and runtime settings out", async () => {
    const registry = makeDescribedRegistry({
        "described-up": availableConfiguration({
            path:                 "/polyadic-agent/api/capabilities",
            runtimeConfiguration: { fields: [{ key: "room_id" }] },
            adapter:              "./adapters/polyadic.adapter.js",
            callbackAuth:         { mode: "keycloak" },
        }),
    });

    const { body } = await getConfiguration(registry, "described-up", "en_US");
    const internals = /room_id|api\/capabilities|adapter|callback|descriptorServiceId/u;

    assert.deepEqual(Object.keys(body.result).sort(),
        ["available", "fields", "locale", "name", "serviceId", "stale", "usesLlm"]);
    assert.equal(internals.test(JSON.stringify(body)), false);
});

test("instance configuration: reports a stale descriptor", async () => {
    const registry = makeDescribedRegistry({
        "described-up": availableConfiguration({ stale: true }),
    });

    const { body } = await getConfiguration(registry, "described-up", "en_US");

    assert.equal(body.result.available, true);
    assert.equal(body.result.stale, true);
});

test("instance configuration: 200 with available false when unavailable", async () => {
    const registry = makeDescribedRegistry({ "described-down": UNAVAILABLE });

    const { status, body } = await getConfiguration(registry, "described-down", "en_US");

    assert.equal(status, 200);
    assert.deepEqual(body.result,
        { serviceId: "described-down", available: false, reason: "unreachable" });
});

test("instance configuration: 404 for unknown, disabled and undescribed services", async () => {
    // The registry answers null for all three (getServiceInstanceConfiguration).
    const registry = makeDescribedRegistry({});

    for (const serviceId of ["unknown", "disabled-service", "plain"]) {
        const { status, body } = await getConfiguration(registry, serviceId, "en_US");
        assert.equal(status, 404, serviceId);
        assert.equal(body.status, "err");
    }
});

test("resolveTeacherLocale: preferred_locale, then Accept-Language, canonical rule", () => {
    const cases = [
        [{ preferredLocale: "es_CL", acceptedLanguages: ["en-US"] }, "es_CL"],
        [{ preferredLocale: "en_US", acceptedLanguages: ["es-CL"] }, "en_US"],
        [{ preferredLocale: "es-AR" }, "es_CL"],
        [{ preferredLocale: "pt_BR" }, "en_US"],
        [{ preferredLocale: null, acceptedLanguages: ["es-CL", "en"] }, "es_CL"],
        [{ preferredLocale: "", acceptedLanguages: ["*", "es"] }, "es_CL"],
        [{ preferredLocale: null, acceptedLanguages: ["fr", "es"] }, "en_US"],
        [{ preferredLocale: null, acceptedLanguages: [] }, "en_US"],
    ];

    for (const [input, expected] of cases) {
        assert.equal(resolveTeacherLocale(input), expected, JSON.stringify(input));
    }
});

test("resolveTeacherLocale: the UI's locale wins over the stored and browser ones", () => {
    const cases = [
        [{ requestedLocale: "es_CL", preferredLocale: "en_US", acceptedLanguages: ["en"] },
            "es_CL"],
        [{ requestedLocale: "en_US", preferredLocale: "es_CL", acceptedLanguages: ["es"] },
            "en_US"],
        [{ requestedLocale: "es", preferredLocale: "en_US" }, "es_CL"],
        [{ requestedLocale: "fr_FR", preferredLocale: "es_CL" }, "en_US"],
        [{ requestedLocale: "  ", preferredLocale: "es_CL" }, "es_CL"],
        [{ requestedLocale: null, acceptedLanguages: ["es-CL"] }, "es_CL"],
    ];

    for (const [input, expected] of cases) {
        assert.equal(resolveTeacherLocale(input), expected, JSON.stringify(input));
    }
});

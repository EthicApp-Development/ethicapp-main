import assert from "node:assert/strict";
import test from "node:test";
import {
    buildEvidenceInventoryRequest,
    register,
} from "../evidence-inventory.adapter.js";

const JOB_ID = "c1d2e3f4-0000-4000-8000-000000000021";
const SERVICE_ID = "argumentation-tutor-evidence-inventory";

const GENERATED_INVENTORY = {
    schemaVersion: "evidence-inventory/v1",
    kind:          "case_evidence_inventory",
    language:      "es_CL",
    facts:         [{
        id:               "EV1",
        group:            "Familia",
        label:            "padres trabajan",
        statement:        "Ambos padres trabajan.",
        sourceQuote:      "ambos papás trabajan",
        sourceQuoteFound: true,
        countingNote:     null,
    }],
    exclusions: [{
        id:        "EX1",
        label:     "becas",
        statement: "Que existen becas.",
        reason:    "El caso no lo dice.",
    }],
    generation: {
        model:         "gpt-5-mini",
        promptVersion: "evidence-inventory-prompt/v1",
        generatedAt:   "2026-10-04T12:00:00Z",
    },
};

function createHarness({ requestJson, dependencies = {} } = {}) {
    const subscribers = new Map();
    const requests = [];
    const callbacks = [];
    const calls = { markProcessing: [], completeJob: [], failJob: [] };

    const client = {
        buildServiceUrl(pathname) {
            return `http://ai.local${pathname}`;
        },
        async requestJson(pathname, options) {
            requests.push({ pathname, options });
            return requestJson ? requestJson(pathname, options) : { taskId: "task-1", status: "pending" };
        },
    };

    const defaultDependencies = {
        markProcessing: async args => {
            calls.markProcessing.push(args);
            return { case_id: args.caseId, status: "processing" };
        },
        completeJob: async args => {
            calls.completeJob.push(args);
            return { case_id: 7, status: "draft" };
        },
        failJob: async args => {
            calls.failJob.push(args);
            return { case_id: 7, status: "failed" };
        },
        createJobId: () => "local-job-id",
        ...dependencies,
    };

    return {
        requests,
        callbacks,
        calls,
        async initialize() {
            await register({
                service: { id: SERVICE_ID },
                subscribe(hookName, handler) {
                    subscribers.set(hookName, handler);
                },
                aiAdditionsClient:             client,
                evidenceInventoryDependencies: defaultDependencies,
            });
        },
        async dispatch(hookName, context) {
            const handler = subscribers.get(hookName);
            assert.equal(typeof handler, "function", `Missing subscriber for ${hookName}`);
            await handler(context, {
                callback: async result => {
                    callbacks.push(result);
                    return result;
                },
            });
        },
    };
}

function caseDocumentContext(overrides = {}) {
    return {
        caseId:        7,
        caseTitle:     "Caso Sebastián",
        caseText:      "Ellos son una familia esforzada: ambos papás trabajan.",
        languageCode:  "es_CL",
        correlationId: JOB_ID,
        ...overrides,
    };
}

// ─── Request contract ─────────────────────────────────────────────────────────

test("buildEvidenceInventoryRequest follows evidence-inventory-request/v1", () => {
    assert.deepEqual(
        buildEvidenceInventoryRequest({
            caseId:        7,
            caseTitle:     " Caso Sebastián ",
            caseText:      "Texto del caso.",
            languageCode:  "es_CL",
            correlationId: JOB_ID,
        }),
        {
            schemaVersion: "evidence-inventory-request/v1",
            case:          {
                id:       "7",
                title:    "Caso Sebastián",
                text:     "Texto del caso.",
                language: "es_CL",
            },
            clientContext: {
                service:       "ethicapp",
                correlationId: JOB_ID,
                caseId:        7,
            },
        }
    );

    const withoutLanguage = buildEvidenceInventoryRequest({
        caseId:        7,
        caseTitle:     "",
        caseText:      "x".repeat(200010),
        languageCode:  "spanish",
        correlationId: JOB_ID,
    });
    assert.equal(withoutLanguage.case.title, "Case 7");
    assert.equal(withoutLanguage.case.text.length, 200000);
    assert.equal("language" in withoutLanguage.case, false);
});

// ─── case-document-ready ──────────────────────────────────────────────────────

test("case-document-ready requests a draft and keeps the job open", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("case-document-ready", caseDocumentContext());

    assert.deepEqual(harness.calls.markProcessing, [{ caseId: 7, serviceId: SERVICE_ID, jobId: JOB_ID }]);
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].pathname, "/evidence-inventories");
    assert.equal(harness.requests[0].options.method, "POST");
    assert.equal(harness.requests[0].options.baseUrl, "http://ai.local/argumentation-tutor/api/v2");
    assert.equal(harness.requests[0].options.body.clientContext.correlationId, JOB_ID);
    assert.equal(harness.callbacks.length, 0, "the tutor callback completes the job");
});

test("case-document-ready uses a local correlation id when no job was created", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("case-document-ready", caseDocumentContext({ correlationId: null }));

    assert.equal(harness.calls.markProcessing[0].jobId, "local-job-id");
    assert.equal(harness.requests[0].options.body.clientContext.correlationId, "local-job-id");
});

test("case-document-ready marks the inventory failed when the case has no text", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("case-document-ready", caseDocumentContext({ caseText: "   " }));

    assert.equal(harness.requests.length, 0);
    assert.deepEqual(harness.calls.failJob, [{
        jobId:        JOB_ID,
        errorMessage: "The case document has no extractable text.",
    }]);
    assert.equal(harness.callbacks[0].status, "skipped");
    assert.equal(harness.callbacks[0].payload.reason, "empty_case_text");
});

test("case-document-ready marks the inventory failed when the tutor cannot be reached", async () => {
    const harness = createHarness({
        requestJson: async () => {
            const error = new Error("Service unavailable");
            error.statusCode = 503;
            throw error;
        },
    });
    await harness.initialize();

    await harness.dispatch("case-document-ready", caseDocumentContext());

    assert.equal(harness.calls.failJob.length, 1);
    assert.equal(harness.callbacks[0].status, "failed");
    assert.deepEqual(harness.callbacks[0].payload, { caseId: 7, reason: "request_failed", statusCode: 503 });
});

// ─── callback-received ────────────────────────────────────────────────────────

function resultCallback(payload, overrides = {}) {
    return {
        correlationId:  JOB_ID,
        requestPayload: {
            schemaVersion: "evidence-inventory-result/v1",
            taskId:        "task-1",
            caseId:        "7",
            error:         null,
            clientContext: { service: "ethicapp", correlationId: JOB_ID, caseId: 7 },
            ...payload,
        },
        ...overrides,
    };
}

test("callback-received stores a completed draft", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("callback-received", resultCallback({
        status:    "completed",
        inventory: GENERATED_INVENTORY,
    }));

    assert.deepEqual(harness.calls.completeJob, [{ jobId: JOB_ID, inventory: GENERATED_INVENTORY }]);
    assert.deepEqual(harness.callbacks[0], {
        serviceId: SERVICE_ID,
        hook:      "callback-received",
        status:    "completed",
        payload:   { caseId: 7, facts: 1, exclusions: 1 },
    });
});

test("callback-received skips results of superseded generations", async () => {
    const harness = createHarness({ dependencies: { completeJob: async () => null } });
    await harness.initialize();

    await harness.dispatch("callback-received", resultCallback({
        status:    "completed",
        inventory: GENERATED_INVENTORY,
    }));

    assert.equal(harness.callbacks[0].status, "skipped");
    assert.equal(harness.callbacks[0].payload.reason, "superseded_job");
});

test("callback-received records provider failures", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("callback-received", resultCallback({
        status:    "failed",
        inventory: null,
        error:     { code: "llm_request_failed", message: "Connection error." },
    }));

    assert.deepEqual(harness.calls.failJob, [{
        jobId:        JOB_ID,
        errorMessage: "llm_request_failed: Connection error.",
    }]);
    assert.equal(harness.callbacks[0].status, "failed");
    assert.equal(harness.callbacks[0].payload.reason, "llm_request_failed");
});

test("callback-received rejects inventories that break the contract", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("callback-received", resultCallback({
        status:    "completed",
        inventory: { ...GENERATED_INVENTORY, facts: [{ statement: "" }] },
    }));

    assert.equal(harness.calls.completeJob.length, 0);
    assert.equal(harness.calls.failJob.length, 1);
    assert.equal(harness.callbacks[0].payload.reason, "invalid_inventory");
});

test("callback-received reports storage errors so the job does not stay open", async () => {
    const harness = createHarness({
        dependencies: {
            completeJob: async () => {
                throw new Error("Error executing SQL query.");
            },
        },
    });
    await harness.initialize();

    await harness.dispatch("callback-received", resultCallback({
        status:    "completed",
        inventory: GENERATED_INVENTORY,
    }));

    assert.equal(harness.callbacks.length, 1);
    assert.equal(harness.callbacks[0].status, "failed");
    assert.equal(harness.callbacks[0].error, "Error executing SQL query.");
});

test("callback-received requires a UUID correlation id", async () => {
    const harness = createHarness();
    await harness.initialize();

    await harness.dispatch("callback-received", resultCallback(
        { status: "completed", inventory: GENERATED_INVENTORY, clientContext: {} },
        { correlationId: "not-a-uuid" }
    ));

    assert.equal(harness.calls.completeJob.length, 0);
    assert.equal(harness.callbacks[0].payload.reason, "invalid_correlation_id");
});

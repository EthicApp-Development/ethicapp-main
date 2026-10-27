import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
    buildCaseEvaluationRequest,
    CASE_ANALYST_API_BASE_PATH,
    CASE_EVALUATION_SCHEMA,
    checkCaseEvaluationDocument,
    getUiTranslations,
    normalizeCaseLanguage,
    register,
    requestFailure,
    serviceFailure,
} from "../case-analyst-evaluation.adapter.js";

const JOB_ID = "6c1f7a52-0000-4000-8000-000000000844";

// The examples Case Analyst publishes in case_evaluation/examples/.
async function readFixture(name) {
    return JSON.parse(await fs.readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

const COMPLETED_RESULT = await readFixture("case-evaluation-result-completed.json");
const FAILED_RESULT    = await readFixture("case-evaluation-result-failed.json");

// A result as Case Analyst would send it for JOB_ID.
function resultFor(example, overrides = {}) {
    return {
        ...structuredClone(example),
        clientContext: { service: "ethicapp", correlationId: JOB_ID, caseId: "7" },
        ...overrides,
    };
}

// Records the calls the adapter makes to its bound case analyses functions.
function makeCaseAnalyses({
    processing = { status: "processing", jobId: JOB_ID },
    recorded = { status: "ready" },
    markProcessing,
} = {}) {
    const calls = [];
    const caseAnalyses = {
        markProcessing: markProcessing ?? (async args => {
            calls.push({ name: "markProcessing", args });
            return processing;
        }),
        complete: async args => {
            calls.push({ name: "complete", args });
            return recorded;
        },
        fail: async args => {
            calls.push({ name: "fail", args });
            return recorded && { status: "failed" };
        },
    };

    return { caseAnalyses, calls };
}

// A fake AI Additions client that records requests and answers with
// `respond(pathname, options)`.
function makeAiAdditionsClient(respond = async () => ({ taskId: "task-1", status: "queued" })) {
    const requests = [];
    return {
        requests,
        requestJson: async (pathname, options) => {
            requests.push({ pathname, ...options });
            return respond(pathname, options);
        },
    };
}

async function quietly(run) {
    const { info, warn } = console;
    console.info = () => {};
    console.warn = () => {};
    try {
        return await run();
    } finally {
        console.info = info;
        console.warn = warn;
    }
}

async function registerAdapter({
    caseAnalyses,
    aiAdditionsClient = makeAiAdditionsClient(),
    renderOutcome = { status: "ready", text: "Camila trabaja en una empresa." },
} = {}) {
    const subscribers = new Map();
    const waited = [];

    await register({
        subscribe:                  (hookName, handler) => subscribers.set(hookName, handler),
        caseAnalyses,
        aiAdditionsClient,
        caseEvaluationDependencies: {
            waitForCaseDocumentText: async caseId => {
                waited.push(caseId);
                return renderOutcome;
            },
        },
    });

    async function dispatch(hookName, context) {
        const results = [];
        await quietly(() => subscribers.get(hookName)(context, {
            callback: async result => { results.push(result); },
        }));
        return results;
    }

    return { subscribers, dispatch, waited, aiAdditionsClient };
}

const CASE_CONTEXT = Object.freeze({
    caseId:       7,
    jobId:        JOB_ID,
    title:        "  Filtro por edad ",
    languageCode: "es_CL",
});

function callbackContext(payload, overrides = {}) {
    return {
        serviceId:      "case-analyst-evaluation",
        eventType:      "result",
        correlationId:  JOB_ID,
        jobId:          JOB_ID,
        requestPayload: payload,
        ...overrides,
    };
}

// ─── registration and texts ──────────────────────────────────────────────────

test("register: subscribes to case-created and callback-received only", async () => {
    const { caseAnalyses } = makeCaseAnalyses();
    const { subscribers } = await registerAdapter({ caseAnalyses });

    assert.deepEqual([...subscribers.keys()].sort(), ["callback-received", "case-created"]);
});

test("getUiTranslations: label, description and tab title in both UI languages", async () => {
    const translations = await getUiTranslations();

    for (const locale of ["es_CL", "en_US"]) {
        for (const key of ["label", "description", "tabTitle"]) {
            assert.ok(translations[locale][key].trim(), `${locale}.${key}`);
        }
    }
    assert.notEqual(translations.es_CL.label, translations.en_US.label);
});

// ─── the request ─────────────────────────────────────────────────────────────

test("normalizeCaseLanguage: Spanish codes are es_CL, any other code en_US", () => {
    assert.equal(normalizeCaseLanguage("es_CL"), "es_CL");
    assert.equal(normalizeCaseLanguage("es"), "es_CL");
    assert.equal(normalizeCaseLanguage("es-AR"), "es_CL");
    assert.equal(normalizeCaseLanguage("ES_es"), "es_CL");
    assert.equal(normalizeCaseLanguage("en_US"), "en_US");
    assert.equal(normalizeCaseLanguage("pt_BR"), "en_US");
    assert.equal(normalizeCaseLanguage("estonian"), "en_US");
    // The column default.
    assert.equal(normalizeCaseLanguage(null), "es_CL");
    assert.equal(normalizeCaseLanguage(""), "es_CL");
});

test("buildCaseEvaluationRequest: the envelope without context, with string ids", () => {
    assert.deepEqual(
        buildCaseEvaluationRequest({
            caseId:       7,
            title:        "  The night shift ",
            text:         "Daniel is a junior nurse.",
            languageCode: "en",
            jobId:        JOB_ID,
        }),
        {
            schemaVersion: "case-evaluation-request/v1",
            case:          {
                id:       "7",
                title:    "The night shift",
                text:     "Daniel is a junior nurse.",
                language: "en_US",
            },
            clientContext: { service: "ethicapp", correlationId: JOB_ID, caseId: "7" },
        }
    );
});

test("buildCaseEvaluationRequest: an empty title falls back; a long one is cut to 500", () => {
    const untitled = buildCaseEvaluationRequest({ caseId: 7, title: " ", text: "x", jobId: JOB_ID });
    const long = buildCaseEvaluationRequest({ caseId: 7, title: "t".repeat(600), text: "x", jobId: JOB_ID });

    assert.equal(untitled.case.title, "Case 7");
    assert.equal(long.case.title.length, 500);
});

// ─── case-created ────────────────────────────────────────────────────────────

test("case-created: starts the generation, waits for the text and posts one request", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const { dispatch, waited, aiAdditionsClient } = await registerAdapter({ caseAnalyses });

    const results = await dispatch("case-created", CASE_CONTEXT);

    assert.deepEqual(calls, [{ name: "markProcessing", args: { caseId: 7, jobId: JOB_ID } }]);
    assert.deepEqual(waited, [7]);
    assert.deepEqual(aiAdditionsClient.requests, [{
        pathname: "/evaluations",
        method:   "POST",
        basePath: CASE_ANALYST_API_BASE_PATH,
        body:     {
            schemaVersion: "case-evaluation-request/v1",
            case:          {
                id:       "7",
                title:    "Filtro por edad",
                text:     "Camila trabaja en una empresa.",
                language: "es_CL",
            },
            clientContext: { service: "ethicapp", correlationId: JOB_ID, caseId: "7" },
        },
    }]);
    assert.equal(CASE_ANALYST_API_BASE_PATH, "/case-analyst/api/v1");
    // The job stays dispatched until the callback.
    assert.deepEqual(results, []);
});

test("case-created: markProcessing is awaited before waiting or requesting", async () => {
    const order = [];
    let releaseMark;
    const marked = new Promise(resolve => { releaseMark = resolve; });
    const { caseAnalyses } = makeCaseAnalyses({
        markProcessing: async () => {
            order.push("markProcessing:start");
            await marked;
            order.push("markProcessing:end");
            return { status: "processing", jobId: JOB_ID };
        },
    });
    const aiAdditionsClient = makeAiAdditionsClient(async () => {
        order.push("request");
        return { taskId: "task-1", status: "queued" };
    });
    const { subscribers } = await registerAdapter({ caseAnalyses, aiAdditionsClient });

    const handled = quietly(() => subscribers.get("case-created")(CASE_CONTEXT, { callback: async () => {} }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ["markProcessing:start"]);

    releaseMark();
    await handled;
    assert.deepEqual(order, ["markProcessing:start", "markProcessing:end", "request"]);
});

test("case-created: a generation that is no longer reserved is skipped without a request", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses({ processing: null });
    const { dispatch, waited, aiAdditionsClient } = await registerAdapter({ caseAnalyses });

    const results = await dispatch("case-created", CASE_CONTEXT);

    assert.deepEqual(calls.map(({ name }) => name), ["markProcessing"]);
    assert.deepEqual(waited, []);
    assert.deepEqual(aiAdditionsClient.requests, []);
    assert.equal(results[0].status, "skipped");
});

test("case-created: a document without text fails the generation with the render outcome", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const { dispatch, aiAdditionsClient } = await registerAdapter({
        caseAnalyses,
        renderOutcome: { status: "render-failed" },
    });

    const results = await dispatch("case-created", CASE_CONTEXT);

    assert.deepEqual(calls[1], {
        name: "fail",
        args: {
            jobId:        JOB_ID,
            errorCode:    "render-failed",
            errorMessage: "The case document could not be rendered.",
        },
    });
    assert.deepEqual(aiAdditionsClient.requests, []);
    assert.equal(results[0].status, "failed");
});

test("case-created: blank or oversized text fails before any request", async () => {
    for (const [text, errorCode] of [["  \n ", "no-text"], ["x".repeat(200001), "case-text-too-long"]]) {
        const { caseAnalyses, calls } = makeCaseAnalyses();
        const { dispatch, aiAdditionsClient } = await registerAdapter({
            caseAnalyses,
            renderOutcome: { status: "ready", text },
        });

        await dispatch("case-created", CASE_CONTEXT);

        assert.equal(calls[1].name, "fail");
        assert.equal(calls[1].args.errorCode, errorCode);
        assert.deepEqual(aiAdditionsClient.requests, []);
    }
});

test("case-created: a rejected request fails the generation", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const aiAdditionsClient = makeAiAdditionsClient(async () => {
        throw Object.assign(new Error("HTTP 422 request failed."), { statusCode: 422 });
    });
    const { dispatch } = await registerAdapter({ caseAnalyses, aiAdditionsClient });

    const results = await dispatch("case-created", CASE_CONTEXT);

    assert.deepEqual(calls.at(-1), {
        name: "fail",
        args: {
            jobId:        JOB_ID,
            errorCode:    "request-rejected",
            errorMessage: "Case Analyst rejected the evaluation request (HTTP 422).",
        },
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "failed");
    assert.equal(results[0].errorCode, "request-rejected");
});

test("case-created: an unreachable service fails the generation", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const aiAdditionsClient = makeAiAdditionsClient(async () => {
        throw new TypeError("fetch failed");
    });
    const { dispatch } = await registerAdapter({ caseAnalyses, aiAdditionsClient });

    const results = await dispatch("case-created", CASE_CONTEXT);

    assert.deepEqual(calls.at(-1).args, {
        jobId:        JOB_ID,
        errorCode:    "request-failed",
        errorMessage: "Case Analyst could not be reached.",
    });
    assert.equal(results[0].status, "failed");
});

test("case-created: an unexpected error after starting fails the generation", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const subscribers = new Map();
    await register({
        subscribe:                  (hookName, handler) => subscribers.set(hookName, handler),
        caseAnalyses,
        aiAdditionsClient:          makeAiAdditionsClient(),
        caseEvaluationDependencies: {
            waitForCaseDocumentText: async () => { throw new Error("database unavailable"); },
        },
    });
    const results = [];

    await quietly(() => subscribers.get("case-created")(CASE_CONTEXT, {
        callback: async result => { results.push(result); },
    }));

    assert.deepEqual(calls.at(-1), {
        name: "fail",
        args: {
            jobId:        JOB_ID,
            errorCode:    "adapter-error",
            errorMessage: "The case evaluation adapter failed unexpectedly.",
        },
    });
    assert.deepEqual(results, [{ hook: "case-created", status: "failed", error: "database unavailable" }]);
});

test("requestFailure: 4xx is rejected; 5xx, network errors and no connection failed", () => {
    assert.equal(requestFailure({ statusCode: 401 }).errorCode, "request-rejected");
    assert.deepEqual(requestFailure({ statusCode: 503 }), {
        errorCode:    "request-failed",
        errorMessage: "Case Analyst could not take the evaluation request (HTTP 503).",
    });
    assert.equal(requestFailure(new Error("aborted")).errorCode, "request-failed");
    assert.equal(
        requestFailure({ code: "not_configured" }).errorMessage,
        "The AI Additions connection is not configured."
    );
});

// ─── callback-received ───────────────────────────────────────────────────────

test("callback-received: a completed result stores the evaluation", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const { dispatch } = await registerAdapter({ caseAnalyses });
    const payload = resultFor(COMPLETED_RESULT);

    const results = await dispatch("callback-received", callbackContext(payload));

    assert.deepEqual(calls, [{
        name: "complete",
        args: { jobId: JOB_ID, documentSchema: CASE_EVALUATION_SCHEMA, document: payload.evaluation },
    }]);
    assert.equal(CASE_EVALUATION_SCHEMA, "case-evaluation/v1");
    assert.deepEqual(results, [{
        hook:   "callback-received",
        status: "completed",
        action: "recorded",
        taskId: COMPLETED_RESULT.taskId,
    }]);
});

test("callback-received: a failed result fails the generation with its code and message", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const { dispatch } = await registerAdapter({ caseAnalyses });

    const results = await dispatch("callback-received", callbackContext(resultFor(FAILED_RESULT)));

    assert.deepEqual(calls, [{
        name: "fail",
        args: {
            jobId:        JOB_ID,
            errorCode:    "service-timeout",
            errorMessage: "The evaluation exceeded its time limit.",
        },
    }]);
    assert.equal(results[0].status, "failed");
    assert.equal(results[0].errorCode, "service-timeout");
});

test("callback-received: a late result of a superseded generation is not stored", async () => {
    for (const example of [COMPLETED_RESULT, FAILED_RESULT]) {
        const { caseAnalyses, calls } = makeCaseAnalyses({ recorded: null });
        const { dispatch } = await registerAdapter({ caseAnalyses });

        const results = await dispatch("callback-received", callbackContext(resultFor(example)));

        assert.equal(calls.length, 1);
        assert.deepEqual(results, [{
            hook:   "callback-received",
            status: "skipped",
            reason: "The generation is no longer the current one for the case.",
        }]);
    }
});

test("callback-received: a callback without a job touches no analysis", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const { dispatch } = await registerAdapter({ caseAnalyses });

    const results = await dispatch("callback-received",
        callbackContext(resultFor(COMPLETED_RESULT), { jobId: null }));

    assert.deepEqual(calls, []);
    assert.equal(results[0].status, "skipped");
});

test("callback-received: a result echoing another request is refused untouched", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const { dispatch } = await registerAdapter({ caseAnalyses });
    const payload = resultFor(COMPLETED_RESULT);
    payload.clientContext.correlationId = "another-job";

    const results = await dispatch("callback-received", callbackContext(payload));

    assert.deepEqual(calls, []);
    assert.equal(results[0].status, "failed");
});

test("callback-received: events other than results are skipped", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const { dispatch } = await registerAdapter({ caseAnalyses });

    const results = await dispatch("callback-received",
        callbackContext(resultFor(COMPLETED_RESULT), { eventType: "progress" }));

    assert.deepEqual(calls, []);
    assert.equal(results[0].status, "skipped");
});

test("callback-received: an unusable payload or evaluation fails the generation", async () => {
    const malformed = resultFor(COMPLETED_RESULT);
    delete malformed.evaluation.synthesis;
    const payloads = [
        null,
        { schemaVersion: "other/v1" },
        resultFor(COMPLETED_RESULT, { status: "running" }),
        malformed,
    ];

    for (const payload of payloads) {
        const { caseAnalyses, calls } = makeCaseAnalyses();
        const { dispatch } = await registerAdapter({ caseAnalyses });

        const results = await dispatch("callback-received", callbackContext(payload));

        assert.equal(calls.length, 1, JSON.stringify(payload)?.slice(0, 80));
        assert.equal(calls[0].name, "fail");
        assert.equal(calls[0].args.errorCode, "invalid-result");
        assert.equal(results[0].status, "failed");
    }
});

test("callback-received: a storage error is reported as a failed callback", async () => {
    const { caseAnalyses } = makeCaseAnalyses();
    caseAnalyses.complete = async () => { throw new Error("database unavailable"); };
    const { dispatch } = await registerAdapter({ caseAnalyses });

    const results = await dispatch("callback-received", callbackContext(resultFor(COMPLETED_RESULT)));

    assert.deepEqual(results, [{ hook: "callback-received", status: "failed", error: "database unavailable" }]);
});

// ─── documents and errors ────────────────────────────────────────────────────

test("checkCaseEvaluationDocument: accepts the published example", () => {
    assert.deepEqual(checkCaseEvaluationDocument(COMPLETED_RESULT.evaluation), []);
});

test("checkCaseEvaluationDocument: lists what the case view cannot read", () => {
    const document = structuredClone(COMPLETED_RESULT.evaluation);
    document.language = "fr_FR";
    document.evaluations[0].results[0].evidence = "not a list";
    document.synthesis.finalFeedback.summary = null;

    assert.deepEqual(checkCaseEvaluationDocument(document), [
        "language must be one of es_CL, en_US.",
        "evaluations[0].results[0].evidence must be a list of strings.",
        "synthesis.finalFeedback.summary must be a string.",
    ]);
    assert.deepEqual(checkCaseEvaluationDocument([]), ["The evaluation must be an object."]);
    assert.ok(checkCaseEvaluationDocument({ schemaVersion: "case-evaluation/v1" }).length > 0);
});

test("serviceFailure: maps every public code; unknown codes are internal errors", () => {
    const codes = ["llm_error", "llm_refusal", "invalid_output", "timeout", "worker_lost", "internal_error"];

    assert.deepEqual(
        codes.map(code => serviceFailure({ code, message: "m" }).errorCode),
        [
            "service-llm-error",
            "service-llm-refusal",
            "service-invalid-output",
            "service-timeout",
            "service-worker-lost",
            "service-internal-error",
        ]
    );
    assert.deepEqual(serviceFailure({ code: "boom" }), {
        errorCode:    "service-internal-error",
        errorMessage: "Case Analyst could not evaluate the case.",
    });
    assert.equal(serviceFailure({ code: "timeout", message: "x".repeat(900) }).errorMessage.length, 500);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
    buildTopicListingRequest,
    CASE_ANALYST_API_BASE_PATH,
    getUiTranslations,
    normalizeCaseLanguage,
    register,
    requestFailure,
    serviceFailure,
    TOPIC_LISTING_SCHEMA,
    validateCaseAnalysisDocument,
} from "../case-analyst-topic-listing.adapter.js";
import { saveCaseAnalysisForOwner } from "../../../controllers/case-analyses.js";

const JOB_ID = "6c1f7a52-0000-4000-8000-000000000845";

// The examples Case Analyst publishes in topic_listing/examples/.
async function readFixture(name) {
    return JSON.parse(await fs.readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

const COMPLETED_RESULT = await readFixture("topic-listing-result-completed.json");
const FAILED_RESULT    = await readFixture("topic-listing-result-failed.json");

// A result as Case Analyst would send it for JOB_ID.
function resultFor(example, overrides = {}) {
    return {
        ...structuredClone(example),
        clientContext: { service: "case-analyst-topic-listing", correlationId: JOB_ID, caseId: "7" },
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
    renderOutcome = { status: "ready", text: "Camila cursa el último año de Enfermería." },
    waitForCaseDocumentText,
} = {}) {
    const subscribers = new Map();
    const waited = [];

    await register({
        subscribe:                (hookName, handler) => subscribers.set(hookName, handler),
        caseAnalyses,
        aiAdditionsClient,
        topicListingDependencies: {
            waitForCaseDocumentText: waitForCaseDocumentText ?? (async caseId => {
                waited.push(caseId);
                return renderOutcome;
            }),
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
    title:        "  La práctica de Camila ",
    languageCode: "es_CL",
});

function callbackContext(payload, overrides = {}) {
    return {
        serviceId:      "case-analyst-topic-listing",
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
    assert.equal(normalizeCaseLanguage("en_US"), "en_US");
    assert.equal(normalizeCaseLanguage("pt_BR"), "en_US");
    assert.equal(normalizeCaseLanguage("estonian"), "en_US");
    // The column default.
    assert.equal(normalizeCaseLanguage(null), "es_CL");
});

test("buildTopicListingRequest: the envelope without context, with string ids", () => {
    assert.deepEqual(
        buildTopicListingRequest({
            caseId:       7,
            title:        "  The night shift ",
            text:         "Daniel is a junior nurse.",
            languageCode: "en",
            jobId:        JOB_ID,
        }),
        {
            schemaVersion: "topic-listing-request/v1",
            case:          {
                id:       "7",
                title:    "The night shift",
                text:     "Daniel is a junior nurse.",
                language: "en_US",
            },
            clientContext: { service: "case-analyst-topic-listing", correlationId: JOB_ID, caseId: "7" },
        }
    );
});

test("buildTopicListingRequest: an empty title falls back; a long one is cut to 500", () => {
    const untitled = buildTopicListingRequest({ caseId: 7, title: " ", text: "x", jobId: JOB_ID });
    const long = buildTopicListingRequest({ caseId: 7, title: "t".repeat(600), text: "x", jobId: JOB_ID });

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
        pathname: "/topic-listings",
        method:   "POST",
        basePath: "/case-analyst/api/v1",
        body:     {
            schemaVersion: "topic-listing-request/v1",
            case:          {
                id:       "7",
                title:    "La práctica de Camila",
                text:     "Camila cursa el último año de Enfermería.",
                language: "es_CL",
            },
            clientContext: { service: "case-analyst-topic-listing", correlationId: JOB_ID, caseId: "7" },
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
    for (const status of ["no-document", "render-failed", "superseded", "timeout"]) {
        const { caseAnalyses, calls } = makeCaseAnalyses();
        const { dispatch, aiAdditionsClient } = await registerAdapter({
            caseAnalyses,
            renderOutcome: { status },
        });

        const results = await dispatch("case-created", CASE_CONTEXT);

        assert.equal(calls[1].name, "fail", status);
        assert.equal(calls[1].args.errorCode, status);
        assert.deepEqual(aiAdditionsClient.requests, []);
        assert.equal(results[0].status, "failed");
    }
});

test("case-created: blank or oversized text fails before any request", async () => {
    for (const [text, errorCode] of [["  \n ", "empty-case-text"], ["x".repeat(200001), "case-text-too-long"]]) {
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
            errorMessage: "Case Analyst rejected the topic listing request (HTTP 422).",
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
    const { dispatch } = await registerAdapter({
        caseAnalyses,
        waitForCaseDocumentText: async () => { throw new Error("database unavailable"); },
    });

    const results = await dispatch("case-created", CASE_CONTEXT);

    assert.deepEqual(calls.at(-1), {
        name: "fail",
        args: {
            jobId:        JOB_ID,
            errorCode:    "adapter-error",
            errorMessage: "The topic listing adapter failed unexpectedly.",
        },
    });
    assert.deepEqual(results, [{ hook: "case-created", status: "failed", error: "database unavailable" }]);
});

test("requestFailure: 4xx is rejected; 5xx, network errors and no connection failed", () => {
    assert.equal(requestFailure({ statusCode: 401 }).errorCode, "request-rejected");
    assert.deepEqual(requestFailure({ statusCode: 503 }), {
        errorCode:    "request-failed",
        errorMessage: "Case Analyst could not take the topic listing request (HTTP 503).",
    });
    assert.equal(requestFailure(new Error("aborted")).errorCode, "request-failed");
    assert.equal(
        requestFailure({ code: "not_configured" }).errorMessage,
        "The AI Additions connection is not configured."
    );
});

// ─── callback-received ───────────────────────────────────────────────────────

test("callback-received: a completed result stores the listing", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const { dispatch } = await registerAdapter({ caseAnalyses });
    const payload = resultFor(COMPLETED_RESULT);

    const results = await dispatch("callback-received", callbackContext(payload));

    assert.deepEqual(calls, [{
        name: "complete",
        args: { jobId: JOB_ID, documentSchema: TOPIC_LISTING_SCHEMA, document: payload.topicListing },
    }]);
    assert.equal(TOPIC_LISTING_SCHEMA, "topic-listing/v1");
    assert.deepEqual(results, [{ hook: "callback-received", status: "completed", action: "recorded" }]);
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
            errorMessage: "The analysis exceeded its time limit of 300 seconds.",
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

test("callback-received: an unusable payload or listing fails the generation", async () => {
    const duplicateIds = resultFor(COMPLETED_RESULT);
    duplicateIds.topicListing.topics[1].id = "T1";
    const blankTopic = resultFor(COMPLETED_RESULT);
    blankTopic.topicListing.topics[0].topic = "   ";
    const extraKey = resultFor(COMPLETED_RESULT);
    extraKey.topicListing.topics[0].priority = 1;
    const noTopics = resultFor(COMPLETED_RESULT);
    noTopics.topicListing.topics = [];
    const payloads = [
        null,
        { schemaVersion: "other/v1" },
        resultFor(COMPLETED_RESULT, { status: "running" }),
        resultFor(COMPLETED_RESULT, { topicListing: undefined }),
        duplicateIds,
        blankTopic,
        extraKey,
        noTopics,
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

test("serviceFailure: maps Case Analyst's core codes; unknown codes are internal errors", () => {
    const expected = {
        timeout:              "service-timeout",
        llm_request_failed:   "service-llm-error",
        llm_not_configured:   "service-llm-error",
        llm_refused:          "service-llm-refusal",
        llm_output_truncated: "service-invalid-output",
        llm_output_invalid:   "service-invalid-output",
        internal_error:       "service-internal-error",
        worker_lost:          "service-worker-lost",
    };

    for (const [code, errorCode] of Object.entries(expected)) {
        assert.equal(serviceFailure({ code, message: "m" }).errorCode, errorCode, code);
    }
    assert.deepEqual(serviceFailure({ code: "boom" }), {
        errorCode:    "service-internal-error",
        errorMessage: "Case Analyst could not list the topics of the case.",
    });
    assert.equal(serviceFailure({ code: "timeout", message: "x".repeat(900) }).errorMessage.length, 500);
});

// ─── teacher edits ───────────────────────────────────────────────────────────

test("validateCaseAnalysisDocument: keeps ids and the stored generation", async () => {
    const stored = COMPLETED_RESULT.topicListing;
    const edit = {
        schemaVersion: "topic-listing/v1",
        language:      "es_CL",
        topics:        [
            { id: "T3", topic: "  Costos de denunciar ", description: "Qué arriesga Camila." },
            { id: "T1", topic: "Veracidad del registro", description: "Si puede firmar.", $$hashKey: "object:7" },
            { id: "", topic: "Lealtad con la supervisora", description: "Si le debe lealtad." },
        ],
        generation: { llmTier: "advanced", prompt: "forged/v9", promptDigest: "ffffffffffff", generatedAt: "2026-01-01T00:00:00Z" },
    };

    const validation = await validateCaseAnalysisDocument(edit, { languageCode: "es_CL", currentDocument: stored });

    assert.deepEqual(validation, {
        documentSchema: "topic-listing/v1",
        document:       {
            schemaVersion: "topic-listing/v1",
            language:      "es_CL",
            topics:        [
                { id: "T3", topic: "Costos de denunciar", description: "Qué arriesga Camila." },
                { id: "T1", topic: "Veracidad del registro", description: "Si puede firmar." },
                // T2 and T4 were removed in this edit, so the new topic is T5.
                { id: "T5", topic: "Lealtad con la supervisora", description: "Si le debe lealtad." },
            ],
            generation: stored.generation,
        },
    });
});

test("validateCaseAnalysisDocument: invalid edits are listed", async () => {
    const tooMany = Array.from({ length: 21 }, (_item, index) => ({
        id: `T${index + 1}`, topic: "A topic", description: "A description",
    }));

    for (const [document, expected] of [
        [null, "The topic listing must be an object."],
        [{ topics: [] }, "The listing must have at least one topic."],
        [{ topics: tooMany }, "The listing can have at most 20 topics."],
        [{ topics: [{ id: "T1", topic: " ", description: "d" }] }, "Topic 1: the topic must not be blank."],
        [{ topics: [{ id: "T1", topic: "t", description: "" }] }, "Topic 1: the description must not be blank."],
        [{ topics: [{ id: "T1", topic: "t".repeat(161), description: "d" }] },
            "Topic 1: the topic must be at most 160 characters long."],
        [{ topics: [{ id: "X1", topic: "t", description: "d" }] }, "Topic 1: the id must look like T1, T2..."],
        [{ topics: [{ id: "T1", topic: "a", description: "d" }, { id: "T1", topic: "b", description: "d" }] },
            "Topic 2: the id T1 is already used by topic 1."],
        [{ language: "fr_FR", topics: [{ id: "T1", topic: "t", description: "d" }] },
            "language must be one of es_CL, en_US."],
    ]) {
        const validation = await validateCaseAnalysisDocument(document, {});
        assert.ok(validation.errors?.includes(expected), `${expected}: ${JSON.stringify(validation)}`);
    }
});

test("saveCaseAnalysisForOwner: a duplicate id answers 400 and nothing is stored", async () => {
    const saved = [];
    const dependencies = {
        getOwnedCase:  async () => ({ id: 7, language_code: "es_CL" }),
        getAnalysis:   async () => ({ status: "ready", document: COMPLETED_RESULT.topicListing }),
        getValidator:  async () => validateCaseAnalysisDocument,
        getCaseText:   async () => "",
        saveReviewed:  async (args) => { saved.push(args); return { status: "ready" }; },
    };
    const topics = [
        { id: "T1", topic: "a", description: "d" },
        { id: "T1", topic: "b", description: "d" },
    ];

    const refused = await saveCaseAnalysisForOwner({
        caseId: 7, serviceId: "case-analyst-topic-listing", userId: 1, document: { topics }, dependencies,
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "CASE_ANALYSIS_DOCUMENT_INVALID");
    assert.deepEqual(saved, []);

    const accepted = await saveCaseAnalysisForOwner({
        caseId: 7, serviceId: "case-analyst-topic-listing", userId: 1,
        document: { topics: [topics[0]] }, dependencies,
    });
    assert.equal(accepted.status, 200);
    assert.equal(saved[0].documentSchema, "topic-listing/v1");
    assert.deepEqual(saved[0].document.generation, COMPLETED_RESULT.topicListing.generation);
});

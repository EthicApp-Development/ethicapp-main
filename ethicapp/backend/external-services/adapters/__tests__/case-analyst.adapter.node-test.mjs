import assert from "node:assert/strict";
import test from "node:test";
import {
    buildCaseAnalysisRequest,
    getCaseAnalystBaseUrl,
    register,
} from "../case-analyst.adapter.js";

const FACADE_BASE = "http://ai-additions.test:8010";

function makeAiAdditionsClient() {
    return {
        buildServiceUrl: pathname => `${FACADE_BASE}${pathname}`,
        requestJson:     async () => { throw new Error("skeleton must not call AI Additions"); },
    };
}

async function registerAdapter() {
    const subscribers = new Map();
    const originalInfo = console.info;
    console.info = () => {};

    try {
        await register({
            service:           { id: "case-analyst" },
            subscribe:         (hookName, handler) => { subscribers.set(hookName, handler); },
            aiAdditionsClient: makeAiAdditionsClient(),
        });
    } finally {
        console.info = originalInfo;
    }

    return subscribers;
}

function makeCallbackRecorder() {
    const results = [];
    return { results, callback: async result => { results.push(result); } };
}

test("getCaseAnalystBaseUrl: prefers the environment override over the facade default", () => {
    const client = makeAiAdditionsClient();
    const original = process.env.AI_ADDITIONS_CASE_ANALYST_API_BASE_URL;

    try {
        delete process.env.AI_ADDITIONS_CASE_ANALYST_API_BASE_URL;
        assert.equal(getCaseAnalystBaseUrl(client), `${FACADE_BASE}/case-analyst/api/v1`);

        process.env.AI_ADDITIONS_CASE_ANALYST_API_BASE_URL = " http://override.test/api ";
        assert.equal(getCaseAnalystBaseUrl(client), "http://override.test/api");
    } finally {
        if (original === undefined) {
            delete process.env.AI_ADDITIONS_CASE_ANALYST_API_BASE_URL;
        } else {
            process.env.AI_ADDITIONS_CASE_ANALYST_API_BASE_URL = original;
        }
    }
});

test("buildCaseAnalysisRequest: builds client_context and case metadata", () => {
    const request = buildCaseAnalysisRequest({
        caseId:         "42",
        caseUuid:       "uuid-42",
        userId:         7,
        correlationId:  "job-uuid",
        title:          "  Autonomous vehicles ",
        languageCode:   "es",
        pdfPath:        "/uploads/cases/42/case.pdf",
        pdfRenderJobId: 99,
    });

    assert.deepEqual(request, {
        client_context: {
            service:       "ethicapp",
            correlationId: "job-uuid",
            caseId:        42,
            caseUuid:      "uuid-42",
            userId:        7,
        },
        case: {
            id:             42,
            title:          "Autonomous vehicles",
            languageCode:   "es",
            pdfPath:        "/uploads/cases/42/case.pdf",
            pdfRenderJobId: 99,
        },
    });
});

test("buildCaseAnalysisRequest: returns null without a valid caseId", () => {
    assert.equal(buildCaseAnalysisRequest({}), null);
    assert.equal(buildCaseAnalysisRequest({ caseId: 0 }), null);
    assert.equal(buildCaseAnalysisRequest(null), null);
});

test("register: subscribes to case-created and callback-received only", async () => {
    const subscribers = await registerAdapter();

    assert.deepEqual([...subscribers.keys()].sort(), ["callback-received", "case-created"]);
});

test("case-created: completes the job with the built request", async () => {
    const subscribers = await registerAdapter();
    const { results, callback } = makeCallbackRecorder();
    const originalInfo = console.info;
    console.info = () => {};

    try {
        await subscribers.get("case-created")(
            { caseId: 42, correlationId: "job-uuid", title: "T" },
            { callback }
        );
    } finally {
        console.info = originalInfo;
    }

    assert.equal(results.length, 1);
    assert.equal(results[0].status, "completed");
    assert.equal(results[0].action, "acknowledged");
    assert.equal(results[0].caseId, 42);
    assert.equal(results[0].analysisRequest.client_context.correlationId, "job-uuid");
});

test("case-created: skips when the context has no caseId", async () => {
    const subscribers = await registerAdapter();
    const { results, callback } = makeCallbackRecorder();

    await subscribers.get("case-created")({ title: "No id" }, { callback });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, "skipped");
});

test("case-created: reports failed when the callback pipeline throws", async () => {
    const subscribers = await registerAdapter();
    const results = [];
    let calls = 0;
    const callback = async result => {
        calls++;
        if (calls === 1) {
            throw new Error("persistence down");
        }
        results.push(result);
    };
    const originalInfo = console.info;
    console.info = () => {};

    try {
        await subscribers.get("case-created")({ caseId: 42 }, { callback });
    } finally {
        console.info = originalInfo;
    }

    assert.equal(results.length, 1);
    assert.equal(results[0].status, "failed");
    assert.equal(results[0].error, "persistence down");
});

test("callback-received: records the provider payload and completes", async () => {
    const subscribers = await registerAdapter();
    const { results, callback } = makeCallbackRecorder();

    await subscribers.get("callback-received")(
        { eventType: "result", requestPayload: { caseId: "42" } },
        { callback }
    );

    assert.equal(results.length, 1);
    assert.equal(results[0].status, "completed");
    assert.equal(results[0].action, "recorded");
    assert.equal(results[0].eventType, "result");
    assert.equal(results[0].caseId, 42);
});

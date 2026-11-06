// The development mock publishes student-result/v1 documents (#1134): the
// document external-mock-service writes goes through publishStudentResult()'s
// document form, and the registry, initialized from the shipped catalog,
// checks it against the schema copy and the catalog entry's `studentOutputs`.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    MOCK_DOCUMENT_LOCALE,
    MOCK_DOCUMENT_SCHEMA,
    register,
    unavailableReviewDocument,
} from "../mock-ai-response-review.adapter.js";
import { ExternalServicesRegistry } from "../../../services/external-services.service.js";
import { validateStudentResultDocument } from "../../../services/student-result-documents.js";
// The service's own builder, at the same path in the backend test image.
import { buildMockReview } from "../../../../../external-mock-service/student-result.js";

const SERVICE_ID = "mock-ai-response-review";
const manifestPath = fileURLToPath(new URL("../../manifest.json", import.meta.url));

const USER_ID = 31;
const CONTEXT = Object.freeze({
    sessionId:       12,
    phaseId:         20,
    questionId:      30,
    userId:          USER_ID,
    requestPayload:  { justification: "private student argument 1134 about the exam" },
    responsePayload: {},
});
const RESULT_ID = "a0000000-0000-4000-8000-000000000034";

async function quietly(action) {
    const channels = ["log", "info", "warn", "error"];
    const originals = Object.fromEntries(channels.map(channel => [channel, console[channel]]));
    const output = [];
    for (const channel of channels) {
        console[channel] = (...args) => { output.push(`${channel} ${args.join(" ")}`); };
    }
    try {
        return { result: await action(), output };
    } finally {
        Object.assign(console, originals);
    }
}

// Replaces fetch with external-mock-service's answer (or `failure`), and
// records the bodies sent.
async function withMockService(action, { failure = null } = {}) {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ path: new URL(url).pathname, body });
        if (failure) {
            throw failure;
        }
        const { document, analysis } = buildMockReview(body);
        return {
            ok:   true,
            json: async () => ({ status: "completed", documentSchema: "student-result/v1", document, analysis }),
        };
    };
    try {
        return { ...(await action()), requests };
    } finally {
        globalThis.fetch = originalFetch;
    }
}

/**
 * A registry initialized from the shipped catalog, with development adapters,
 * whose student notifications are recorded; and the mock's handlers,
 * registered with the registry's own publishStudentResult(). A descriptor
 * request fails the test: the mock links none.
 */
async function mockWithRegistry() {
    const sent = [];
    const registry = new ExternalServicesRegistry({
        jobsService:           {},
        developmentAdapters:   true,
        capabilityDescriptors: new Proxy({}, {
            get: (target, name) => () => assert.fail(`no descriptor read expected (${String(name)})`),
        }),
        notifyStudentResult: (userId, event) => {
            sent.push({ userId, event });
            return true;
        },
    });
    await quietly(() => registry.initialize(manifestPath));

    const handlers = new Map();
    const callbacks = [];
    await register({
        service:              { id: SERVICE_ID },
        subscribe:            (hookName, handler) => handlers.set(hookName, handler),
        publishStudentResult: payload => registry.publishStudentResult(SERVICE_ID, payload),
    });
    const run = (hookName, context) => handlers.get(hookName)(context, {
        callback: async result => { callbacks.push(result); },
    });
    return { registry, sent, callbacks, run };
}

test("the catalog entry declares student-result/v1 for the response scope", async () => {
    const { registry } = await mockWithRegistry();

    assert.deepEqual(registry.services.get(SERVICE_ID).studentOutputs, [{
        id:             "mock-review",
        documentSchema: MOCK_DOCUMENT_SCHEMA,
        scopes:         ["response"],
        label:          "Mock review",
        description:    "Development review of each response a student submits: "
            + "its word and character counts and its text backwards.",
    }]);
});

test("a submitted response is reviewed and published as the service's document", async () => {
    const { sent, callbacks, run } = await mockWithRegistry();

    const { output, requests } = await withMockService(() => quietly(
        () => run("student-response-submitted", CONTEXT)
    ));

    assert.deepEqual(requests, [{
        path: "/response-review/student-result",
        body: { text: CONTEXT.requestPayload.justification, locale: MOCK_DOCUMENT_LOCALE },
    }]);
    assert.equal(sent.length, 1, output.join("\n"));
    const { userId, event } = sent[0];
    assert.equal(userId, USER_ID);
    assert.deepEqual(event.component, { documentSchema: "student-result/v1" });
    assert.deepEqual(
        event.payload,
        buildMockReview({ text: CONTEXT.requestPayload.justification, locale: MOCK_DOCUMENT_LOCALE }).document
    );
    assert.deepEqual(
        Object.keys(event).sort(),
        ["component", "message", "payload", "phaseId", "questionId", "receivedAt", "serviceId",
            "sessionId", "status", "userId"],
        "no resultId: the mock publishes without a stored callback"
    );

    // Every section kind, the overview and the criterion descriptions.
    const document = event.payload;
    assert.equal(document.locale, "es-CL");
    assert.ok(document.overview);
    assert.deepEqual(
        document.sections.map(section => section.kind),
        ["criteria", "bullets", "mock-future-kind", "text", "comparison"]
    );
    assert.ok(document.sections[0].items.every(item => item.description));
    assert.deepEqual(validateStudentResultDocument("student-result/v1", document), { valid: true, problems: [] });

    // The job result holds counts, not the student's text.
    assert.equal(callbacks.length, 1);
    assert.deepEqual(callbacks[0].payload.analysis, {
        wordCount: 7, hasFreeText: true, reviewAvailable: true, published: true,
    });
    assert.doesNotMatch(JSON.stringify(callbacks[0]), /private student/u);
    assert.doesNotMatch(output.join("\n"), /private student/u);
});

test("an en_US activity gets the mock's review in English (context.locale, #1124)", async () => {
    const { sent, run } = await mockWithRegistry();
    const context = { ...CONTEXT, locale: "en_US" };

    const { output, requests } = await withMockService(() => quietly(
        () => run("student-response-submitted", context)
    ));

    assert.deepEqual(requests[0].body.locale, "en-US");
    assert.equal(sent.length, 1, output.join("\n"));
    assert.deepEqual(
        sent[0].event.payload,
        buildMockReview({ text: CONTEXT.requestPayload.justification, locale: "en-US" }).document
    );
});

test("without the mock service, an en_US activity gets the unavailable review in English", async () => {
    const { sent, run } = await mockWithRegistry();

    await withMockService(
        () => quietly(() => run("student-response-submitted", { ...CONTEXT, locale: "en_US" })),
        { failure: new TypeError("fetch failed") }
    );

    assert.deepEqual(sent[0].event.payload, unavailableReviewDocument("en-US"));
    assert.equal(sent[0].event.payload.locale, "en-US");
    assert.deepEqual(
        validateStudentResultDocument("student-result/v1", unavailableReviewDocument("en-US")),
        { valid: true, problems: [] }
    );
});

test("the documents of both locales and of an empty response validate", () => {
    for (const locale of ["es-CL", "en-US"]) {
        for (const text of ["", "One word", "a ".repeat(6000)]) {
            const { document } = buildMockReview({ text, locale });
            assert.deepEqual(
                validateStudentResultDocument("student-result/v1", document),
                { valid: true, problems: [] },
                `${locale}, ${text.length} characters`
            );
        }
    }
});

test("without the mock service, an unavailable document is published", async () => {
    const { sent, callbacks, run } = await mockWithRegistry();

    const { output } = await withMockService(
        () => quietly(() => run("student-response-submitted", CONTEXT)),
        { failure: new TypeError("fetch failed") }
    );

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].event.payload, unavailableReviewDocument());
    assert.equal(sent[0].event.payload.status, "unavailable");
    assert.deepEqual(
        validateStudentResultDocument("student-result/v1", unavailableReviewDocument()),
        { valid: true, problems: [] }
    );
    assert.equal(callbacks[0].payload.analysis.reviewAvailable, false);
    assert.doesNotMatch(output.join("\n"), /private student/u);
});

test("a document the mock service gets wrong is refused, with codes only", async () => {
    const { sent, callbacks, run } = await mockWithRegistry();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok:   true,
        json: async () => ({
            status:         "completed",
            documentSchema: "student-result/v1",
            document:       { ...unavailableReviewDocument(), claimTypeId: "private student AF1" },
        }),
    });

    let output;
    try {
        ({ output } = await quietly(() => run("student-response-submitted", CONTEXT)));
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(sent, []);
    assert.equal(callbacks[0].payload.analysis.published, false);
    const refusal = output.find(line => line.includes("Refused a student result document."));
    assert.ok(refusal, output.join("\n"));
    assert.match(refusal, /"code":"schema_violation"/u);
    assert.doesNotMatch(output.join("\n"), /private student/u);
});

test("a schema the catalog entry does not declare is refused", async () => {
    const { registry, sent } = await mockWithRegistry();

    const { result, output } = await quietly(() => registry.publishStudentResult(SERVICE_ID, {
        userId:         USER_ID,
        documentSchema: "quiz/v1",
        document:       unavailableReviewDocument(),
    }));

    assert.equal(result, false);
    assert.deepEqual(sent, []);
    const refusal = JSON.parse(output.find(line => line.includes("Refused")).replace(/^[^{]*/u, ""));
    assert.equal(refusal.declaration, "known");
    assert.deepEqual(refusal.problems.map(problem => problem.code), [
        "undeclared_document_schema", "unknown_document_schema",
    ]);
});

test("a callback publishes the document it carries, with the stored callback's id", async () => {
    const { sent, callbacks, run } = await mockWithRegistry();
    const { document } = buildMockReview({ text: "From a callback.", locale: "en-US" });

    await quietly(() => run("callback-received", {
        resultId:       RESULT_ID,
        requestPayload: {
            userId:         USER_ID,
            sessionId:      12,
            phaseId:        20,
            questionId:     30,
            status:         "completed",
            message:        "Ready.",
            documentSchema: "student-result/v1",
            document,
            // The legacy form is no longer passed through.
            component:      { componentId: "argument-tutor-report" },
        },
    }));

    assert.equal(sent.length, 1);
    assert.equal(sent[0].event.resultId, RESULT_ID);
    assert.deepEqual(sent[0].event.component, { documentSchema: "student-result/v1" });
    assert.deepEqual(sent[0].event.payload, document);
    assert.equal(Object.hasOwn(callbacks[0].payload, "component"), false);
});

test("a callback without a document publishes nothing", async () => {
    const { sent, callbacks, run } = await mockWithRegistry();

    await quietly(() => run("callback-received", {
        resultId:       RESULT_ID,
        requestPayload: {
            userId:    USER_ID,
            component: { componentId: "argument-tutor-report" },
            payload:   { summary: "legacy" },
        },
    }));

    assert.deepEqual(sent, []);
    assert.equal(callbacks.length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
    buildMockCaseAnalysis,
    MOCK_CASE_ANALYSIS_SCHEMA,
    register,
    validateCaseAnalysisDocument,
} from "../mock-case-analysis.adapter.js";

const JOB_ID = "f1a2b3c4-0000-4000-8000-000000000051";

// Records the calls the adapter makes to its bound case analyses functions.
function makeCaseAnalyses({ processing = { status: "processing", jobId: JOB_ID }, complete } = {}) {
    const calls = [];
    const caseAnalyses = {
        markProcessing: async args => {
            calls.push({ name: "markProcessing", args });
            return processing;
        },
        complete: complete ?? (async args => {
            calls.push({ name: "complete", args });
            return { status: "ready" };
        }),
        fail: async args => {
            calls.push({ name: "fail", args });
            return { status: "failed" };
        },
    };

    return { caseAnalyses, calls };
}

// Registers the adapter and returns its case-created handler.
async function registerAdapter({ caseAnalyses, renderOutcome }) {
    const subscribers = new Map();
    const waited = [];

    await register({
        subscribe:                    (hookName, handler) => subscribers.set(hookName, handler),
        caseAnalyses,
        mockCaseAnalysisDependencies: {
            waitForCaseDocumentText: async caseId => {
                waited.push(caseId);
                return renderOutcome;
            },
        },
    });

    return { handler: subscribers.get("case-created"), waited };
}

async function runCaseCreated(handler) {
    const results = [];
    const callback = async result => { results.push(result); };
    await handler({ caseId: 7, jobId: JOB_ID }, { callback });
    return results;
}

// ─── case-created ────────────────────────────────────────────────────────────

test("case-created: stores the word count and excerpt once the document is rendered", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const { handler, waited } = await registerAdapter({
        caseAnalyses,
        renderOutcome: { status: "ready", text: "An  ethical\ncase." },
    });

    const results = await runCaseCreated(handler);

    assert.deepEqual(waited, [7]);
    assert.deepEqual(calls, [
        { name: "markProcessing", args: { caseId: 7, jobId: JOB_ID } },
        {
            name: "complete",
            args: {
                jobId:          JOB_ID,
                documentSchema: MOCK_CASE_ANALYSIS_SCHEMA,
                document:       { wordCount: 3, characterCount: 16, excerpt: "An ethical case." },
            },
        },
    ]);
    assert.equal(results[0].status, "completed");
});

test("case-created: fails the analysis with the render outcome when there is no text", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses();
    const { handler } = await registerAdapter({
        caseAnalyses,
        renderOutcome: { status: "render-failed" },
    });

    const results = await runCaseCreated(handler);

    assert.deepEqual(calls[1], {
        name: "fail",
        args: {
            jobId:        JOB_ID,
            errorCode:    "render-failed",
            errorMessage: "The case document could not be rendered.",
        },
    });
    assert.equal(results[0].status, "failed");
});

test("case-created: skips generations that are no longer reserved, without waiting", async () => {
    const { caseAnalyses, calls } = makeCaseAnalyses({ processing: null });
    const { handler, waited } = await registerAdapter({
        caseAnalyses,
        renderOutcome: { status: "ready", text: "Text." },
    });

    const results = await runCaseCreated(handler);

    assert.deepEqual(waited, []);
    assert.deepEqual(calls.map(({ name }) => name), ["markProcessing"]);
    assert.equal(results[0].status, "skipped");
});

test("case-created: reports a failed job when the result cannot be stored", async () => {
    const { caseAnalyses } = makeCaseAnalyses({
        complete: async () => { throw new Error("database unavailable"); },
    });
    const { handler } = await registerAdapter({
        caseAnalyses,
        renderOutcome: { status: "ready", text: "Text." },
    });

    const results = await runCaseCreated(handler);

    assert.deepEqual(results, [{
        hook:   "case-created",
        status: "failed",
        error:  "database unavailable",
    }]);
});

// ─── documents ───────────────────────────────────────────────────────────────

test("buildMockCaseAnalysis: counts words and keeps the first 280 characters", () => {
    const longText = "word ".repeat(100);

    assert.deepEqual(buildMockCaseAnalysis(""), { wordCount: 0, characterCount: 0, excerpt: "" });
    assert.equal(buildMockCaseAnalysis(longText).wordCount, 100);
    assert.equal(buildMockCaseAnalysis(longText).excerpt.length, 280);
});

test("validateCaseAnalysisDocument: returns the trimmed document with its schema", () => {
    const edit = { wordCount: 3, characterCount: 16, excerpt: " An edit. ", extra: 1 };

    assert.deepEqual(
        validateCaseAnalysisDocument(edit),
        {
            documentSchema: MOCK_CASE_ANALYSIS_SCHEMA,
            document:       { wordCount: 3, characterCount: 16, excerpt: "An edit." },
        }
    );
});

test("validateCaseAnalysisDocument: lists every invalid field", () => {
    const { errors } = validateCaseAnalysisDocument({
        wordCount:      -1,
        characterCount: 1.5,
        excerpt:        "x".repeat(281),
    });

    assert.equal(errors.length, 3);
    assert.deepEqual(validateCaseAnalysisDocument(null).errors.length, 3);
});

import assert from "node:assert/strict";
import test from "node:test";
import { hashAnalysisInput, sha256Text } from "../../../helpers/analysis-input-hash.js";
import {
    buildMockDesignAnalysis,
    designAnalysisInput,
    getUiTranslations,
    MOCK_DESIGN_ANALYSIS_SCHEMA,
    register,
} from "../mock-design-analysis.adapter.js";

const JOB_ID = "f1a2b3c4-0000-4000-8000-000000000091";

const TUTOR = { externalServices: { enabledServiceIds: ["argumentation-tutor-system"] } };

function designWith(phases) {
    return { type: "semantic_differential", valid: true, phases };
}

const DESIGN = designWith([
    { ...TUTOR, questions: [{ q_text: "Should Ana report it?" }, { q_text: " " }, { q_text: "Why?" }] },
    { questions: [{ q_text: "Not discussed with the tutor." }] },
    { ...TUTOR, questions: [{ q_text: "**Who** is responsible?", q_text_content_type: "text/markdown" }] },
]);

const DESIGN_CASE = { id: 42, title: "A case", languageCode: "es", contentHash: "sha256:pdf" };

// ─── input ───────────────────────────────────────────────────────────────────

test("designAnalysisInput: selects the tutor questions with positional ids", () => {
    const { input, hash } = designAnalysisInput({ design: DESIGN, designCase: DESIGN_CASE });

    assert.deepEqual(input.case, { languageCode: "es", contentHash: "sha256:pdf" });
    assert.deepEqual(input.questions.map(({ id, phaseNumber, questionNumber, text }) => [
        id, phaseNumber, questionNumber, text,
    ]), [
        ["p1-q1", 1, 1, "Should Ana report it?"],
        ["p1-q3", 1, 3, "Why?"],
        ["p3-q1", 3, 1, "Who is responsible?"],
    ]);
    assert.equal(input.questions[0].textHash, sha256Text("Should Ana report it?"));
    assert.equal(hash, hashAnalysisInput({
        case:      input.case,
        questions: input.questions.map(({ id, textHash }) => ({ id, textHash })),
    }));
});

test("designAnalysisInput: declines without a case or without tutor questions", () => {
    assert.equal(designAnalysisInput({ design: DESIGN, designCase: null }), null);
    assert.equal(designAnalysisInput({
        design:     designWith([{ questions: [{ q_text: "No tutor here." }] }]),
        designCase: DESIGN_CASE,
    }), null);
    assert.equal(designAnalysisInput({
        design:     designWith([{ ...TUTOR, questions: [{ q_text: "" }] }]),
        designCase: DESIGN_CASE,
    }), null);
});

test("designAnalysisInput: the hash changes with a question, the case or its language only", () => {
    const hashOf = (design, designCase = DESIGN_CASE) =>
        designAnalysisInput({ design, designCase }).hash;
    const base = hashOf(DESIGN);

    assert.equal(hashOf(structuredClone(DESIGN)), base, "the same content, the same hash");
    assert.equal(hashOf(DESIGN, { ...DESIGN_CASE, id: 99, title: "Copy" }), base,
        "a copied case keeps the hash");

    const edited = structuredClone(DESIGN);
    edited.phases[0].questions[2].q_text = "Why not?";
    assert.notEqual(hashOf(edited), base);

    const untouchedPhase = structuredClone(DESIGN);
    untouchedPhase.phases[1].questions[0].q_text = "Changed outside the tutor.";
    assert.equal(hashOf(untouchedPhase), base, "phases without the tutor do not count");

    assert.notEqual(hashOf(DESIGN, { ...DESIGN_CASE, contentHash: "sha256:other" }), base);
    assert.notEqual(hashOf(DESIGN, { ...DESIGN_CASE, languageCode: "en" }), base);
});

// ─── document ────────────────────────────────────────────────────────────────

test("buildMockDesignAnalysis: counts tutor phases, questions and words", () => {
    const { input } = designAnalysisInput({ design: DESIGN, designCase: DESIGN_CASE });

    const document = buildMockDesignAnalysis(input);

    assert.equal(document.phaseCount, 2);
    assert.equal(document.questionCount, 3);
    assert.deepEqual(document.questions.map(({ id, wordCount }) => [id, wordCount]), [
        ["p1-q1", 4],
        ["p1-q3", 1],
        ["p3-q1", 3],
    ]);
});

test("getUiTranslations: Spanish and English texts", async () => {
    const translations = await getUiTranslations();

    assert.deepEqual(Object.keys(translations).sort(), ["en_US", "es_CL"]);
    for (const locale of ["es_CL", "en_US"]) {
        assert.ok(translations[locale].label);
        assert.ok(translations[locale].description);
    }
});

// ─── design-saved ────────────────────────────────────────────────────────────

function makeDesignAnalyses({ processing = { status: "processing", jobId: JOB_ID }, complete } = {}) {
    const calls = [];
    const designAnalyses = {
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

    return { designAnalyses, calls };
}

async function runDesignSaved(designAnalyses, context) {
    const subscribers = new Map();
    await register({ subscribe: (hookName, handler) => subscribers.set(hookName, handler), designAnalyses });

    const results = [];
    await subscribers.get("design-saved")(
        { designId: 5, jobId: JOB_ID, ...context },
        { callback: async result => { results.push(result); } }
    );
    return results;
}

test("design-saved: stores the analysis of the input it was dispatched with", async () => {
    const { designAnalyses, calls } = makeDesignAnalyses();
    const { input } = designAnalysisInput({ design: DESIGN, designCase: DESIGN_CASE });

    const results = await runDesignSaved(designAnalyses, { analysisInput: input });

    assert.deepEqual(calls, [
        { name: "markProcessing", args: { designId: 5, jobId: JOB_ID } },
        {
            name: "complete",
            args: {
                jobId:          JOB_ID,
                documentSchema: MOCK_DESIGN_ANALYSIS_SCHEMA,
                document:       buildMockDesignAnalysis(input),
            },
        },
    ]);
    assert.deepEqual(results, [{ hook: "design-saved", status: "completed", designId: 5 }]);
});

test("design-saved: skips a generation that is no longer reserved", async () => {
    const { designAnalyses, calls } = makeDesignAnalyses({ processing: null });

    const results = await runDesignSaved(designAnalyses, { analysisInput: { questions: [] } });

    assert.deepEqual(calls.map(call => call.name), ["markProcessing"]);
    assert.equal(results[0].status, "skipped");
});

test("design-saved: a superseded job's result is not stored", async () => {
    const { designAnalyses } = makeDesignAnalyses({ complete: async () => null });

    const results = await runDesignSaved(designAnalyses, { analysisInput: { questions: [] } });

    assert.equal(results[0].status, "skipped");
});

test("design-saved: fails a generation without input, and one whose storage fails", async () => {
    const missing = makeDesignAnalyses();
    const missingResults = await runDesignSaved(missing.designAnalyses, {});
    assert.deepEqual(missing.calls[1], {
        name: "fail",
        args: {
            jobId:        JOB_ID,
            errorCode:    "missing-input",
            errorMessage: "The generation carries no analysis input.",
        },
    });
    assert.equal(missingResults[0].status, "failed");

    const broken = makeDesignAnalyses({ complete: async () => { throw new Error("db down"); } });
    const brokenResults = await runDesignSaved(broken.designAnalyses, { analysisInput: { questions: [] } });
    assert.equal(broken.calls[1].name, "fail");
    assert.equal(broken.calls[1].args.errorCode, "adapter-error");
    assert.deepEqual(brokenResults, [{ hook: "design-saved", status: "failed", error: "db down" }]);
});

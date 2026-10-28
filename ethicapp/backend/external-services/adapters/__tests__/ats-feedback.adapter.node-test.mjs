import assert from "node:assert/strict";
import test from "node:test";
import {
    buildArgumentClientContext,
    buildAtsSessionPayload,
    buildFeedbackPayloadFromAtsStatus,
    buildFeedbackPayloadFromExternalResult,
    claimTypeFromExternalResult,
    createAtsSession,
    differentialQuestionText,
    phaseInstructionsText,
    questionTextFromPhaseDesign,
    tutorEvaluationFromExternalResult,
} from "../ats-feedback.utils.js";
import { sessionTutorMode } from "../ats-feedback.adapter.js";

// ─── buildArgumentClientContext ───────────────────────────────────────────────

test("buildArgumentClientContext includes correlationId from context", () => {
    const ctx = buildArgumentClientContext(
        { correlationId: "job-uuid-001", sessionId: 1, phaseId: 2, questionId: 3 },
        42
    );

    assert.equal(ctx.service,       "ethicapp");
    assert.equal(ctx.correlationId, "job-uuid-001");
    assert.equal(ctx.sessionId,     1);
    assert.equal(ctx.phaseId,       2);
    assert.equal(ctx.questionId,    3);
    assert.equal(ctx.groupId,       42);
});

test("buildArgumentClientContext uses null when correlationId absent", () => {
    const ctx = buildArgumentClientContext({ sessionId: 1, phaseId: 2 }, null);
    assert.equal(ctx.correlationId, null);
});

test("buildArgumentClientContext uses null for non-integer groupId", () => {
    const ctx = buildArgumentClientContext({ correlationId: "c" }, "not-a-number");
    assert.equal(ctx.groupId, null);
});

// ─── feedback payload argument previews ──────────────────────────────────────

test("buildFeedbackPayloadFromAtsStatus prefers submitted argument text for first analysis", () => {
    const payload = buildFeedbackPayloadFromAtsStatus(
        {
            message: JSON.stringify({
                analysis:          "Feedback summary.",
                original_argument: "LLM paraphrase of the argument",
                claim:             1,
                evidence:          0,
                warrant:           1,
                qualifier:         0,
            }),
        },
        { sessionId: 10, phaseId: 20, questionId: 30, userId: 40 },
        {
            mode:                   "arguments",
            revisedArgumentPreview: "Exact text typed by the student.",
        }
    );

    assert.equal(payload.mode, "analysis");
    assert.equal(payload.argumentPreview, "Exact text typed by the student.");
    assert.equal(payload.meta.phaseId, 20);
});

test("buildFeedbackPayloadFromAtsStatus prefers stored previous argument for comparisons", () => {
    const payload = buildFeedbackPayloadFromAtsStatus(
        {
            message: JSON.stringify({
                original_argument: "LLM paraphrase of previous argument",
                revised_argument:  "LLM revised argument",
                initial_scores:    { claim: 0 },
                revised_scores:    { claim: 1 },
                improvements:      { claim: 1 },
            }),
        },
        { sessionId: 10, phaseId: 20, questionId: 30, userId: 40 },
        {
            mode:                   "compare",
            initialArgumentPreview: "Exact previous argument.",
            revisedArgumentPreview: "Exact current argument.",
        }
    );

    assert.equal(payload.mode, "comparison");
    assert.equal(payload.comparison.initialArgument, "Exact previous argument.");
    assert.equal(payload.comparison.revisedArgument, "Exact current argument.");
    assert.equal(payload.argumentPreview, "Exact current argument.");
});

test("buildFeedbackPayloadFromExternalResult maps submitted_argument into argumentPreview", () => {
    const payload = buildFeedbackPayloadFromExternalResult(
        {
            sessionId:  "10",
            phaseId:    "20",
            questionId: "30",
            userId:     "40",
            payload:    {
                feedback: {
                    mode:               "analysis",
                    summary:            "Callback feedback.",
                    submitted_argument: "External callback submitted text.",
                },
            },
        },
        {}
    );

    assert.equal(payload.mode, "analysis");
    assert.equal(payload.argumentPreview, "External callback submitted text.");
    assert.equal(payload.meta.userId, 40);
});

// ─── Session creation with the configured LLM tier (#736) ───────────────────

const METADATA = Object.freeze({
    caseId:    51,
    caseTitle: "Caso Sebastián",
    caseText:  "Case text.",
    question:  "Should Sebastián report the error?",
});

test("buildAtsSessionPayload sends no tier without a configuration", () => {
    for (const configuration of [undefined, {}, { llm_tier: null }, { llm_tier: "  " }]) {
        assert.deepEqual(buildAtsSessionPayload(METADATA, configuration), {
            case_id:    51,
            case_title: "Caso Sebastián",
            case_text:  "Case text.",
            question:   "Should Sebastián report the error?",
        }, JSON.stringify(configuration));
    }
});

test("buildAtsSessionPayload sends the configured llm_tier, never model", () => {
    const body = buildAtsSessionPayload(METADATA, { llm_tier: "advanced", model: "gpt-4.1" });

    assert.equal(body.llm_tier, "advanced");
    assert.equal(Object.hasOwn(body, "model"), false);
});

test("createAtsSession passes the tutor's warnings and degraded mode through", async () => {
    const bodies = [];
    const warning = { field: "llm_tier", verdict: "substituted", message: "x" };

    const created = await createAtsSession({
        metadata:             METADATA,
        serviceConfiguration: { llm_tier: "advanced" },
        request:              async (body) => {
            bodies.push(body);
            return {
                session_id: "ats-1", llm_tier:   "advanced", model:      "gpt-4.1",
                warnings:   [warning], degraded:   true,
            };
        },
    });

    assert.equal(bodies[0].llm_tier, "advanced");
    assert.deepEqual(created, {
        sessionId: "ats-1",
        creation:  {
            llmTier:               "advanced",
            model:                 "gpt-4.1",
            warnings:              [warning],
            degraded:              true,
            configurationRejected: false,
        },
    });
});

test("createAtsSession retries with the tutor's defaults when the tier is rejected", async () => {
    const bodies = [];
    const rejection = { error: "Invalid instance configuration", errors: { llm_tier: "bad" } };
    const originalWarn = console.warn;
    console.warn = () => {};

    try {
        const created = await createAtsSession({
            metadata:             METADATA,
            serviceConfiguration: { llm_tier: 7 },
            request:              async (body) => {
                bodies.push(body);
                if (bodies.length === 1) {
                    const error = new Error("HTTP 400");
                    error.statusCode = 400;
                    error.responseBody = rejection;
                    throw error;
                }
                return { session_id: "ats-2", llm_tier: "basic", warnings: [], degraded: false };
            },
        });

        assert.equal(bodies[0].llm_tier, "7");
        assert.equal(Object.hasOwn(bodies[1], "llm_tier"), false);
        assert.equal(created.creation.configurationRejected, true);
        assert.deepEqual(created.creation.rejection, rejection);
        assert.equal(created.creation.llmTier, "basic");
    } finally {
        console.warn = originalWarn;
    }
});

test("createAtsSession does not retry other failures", async () => {
    let calls = 0;
    const failing = async () => {
        calls += 1;
        const error = new Error("HTTP 400");
        error.statusCode = 400;
        throw error;
    };

    await assert.rejects(createAtsSession({ metadata: METADATA, request: failing }), /HTTP 400/u);
    assert.equal(calls, 1, "no configured tier, no retry");

    await assert.rejects(createAtsSession({
        metadata: METADATA,
        request:  async () => ({ warnings: [] }),
    }), /did not return a session_id/u);
});

// ─── Case context in the session (#865) ─────────────────────────────────────

const CASE_CONTEXT = Object.freeze({
    schemaVersion:     "tutor-case-context/v1",
    evidenceInventory: { schemaVersion: "evidence-inventory/v1", facts: [], exclusions: [] },
    claimTypology:     {
        schemaVersion: "tutor-claim-typology/v1",
        focalAction:   "report the error",
        types:         [{ id: "AF1", label: "Report", description: "d", stance: "in_favor" }],
    },
});

function badRequest(responseBody) {
    const error = new Error("HTTP 400");
    error.statusCode = 400;
    error.responseBody = responseBody;
    return error;
}

async function withoutWarnings(run) {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        return await run();
    } finally {
        console.warn = originalWarn;
    }
}

test("buildAtsSessionPayload sends the case context as case_context, never claim_typology", () => {
    const body = buildAtsSessionPayload(METADATA, {}, CASE_CONTEXT);

    assert.deepEqual(body.case_context, CASE_CONTEXT);
    assert.equal(Object.hasOwn(body, "claim_typology"), false);
    const basic = buildAtsSessionPayload(METADATA, {}, null);
    assert.equal(Object.hasOwn(basic, "case_context"), false);
    assert.equal(Object.hasOwn(basic, "claim_typology"), false);
});

test("createAtsSession reports a context the tutor used for an enhanced session", async () => {
    const bodies = [];
    const created = await createAtsSession({
        metadata:    METADATA,
        caseContext: CASE_CONTEXT,
        request:     async (body) => {
            bodies.push(body);
            return { session_id: "ats-1", warnings: [], degraded: false, mode: "enhanced" };
        },
    });

    assert.equal(bodies.length, 1);
    assert.deepEqual(bodies[0].case_context, CASE_CONTEXT);
    assert.equal(created.creation.caseContext, "used");
    assert.equal(created.creation.tutorMode, "enhanced");
});

test("createAtsSession reports a tutor that answers without a mode as unsupported", async () => {
    const warning = { field: "case_context", verdict: "unsupported", message: "unknown field" };
    const created = await createAtsSession({
        metadata:    METADATA,
        caseContext: CASE_CONTEXT,
        request:     async () => ({ session_id: "ats-1", warnings: [warning], degraded: true }),
    });

    assert.equal(created.sessionId, "ats-1");
    assert.equal(created.creation.caseContext, "unsupported");
    assert.equal(Object.hasOwn(created.creation, "tutorMode"), false);
    assert.equal(created.creation.configurationRejected, false);
});

test("createAtsSession reports a session the tutor opened in the basic mode anyway", async () => {
    const created = await createAtsSession({
        metadata:    METADATA,
        caseContext: CASE_CONTEXT,
        request:     async () => ({
            session_id: "ats-1", warnings: [], mode: "basic", missing: ["claimTypology"],
        }),
    });

    assert.equal(created.creation.caseContext, "downgraded");
    assert.equal(created.creation.tutorMode, "basic");
    assert.deepEqual(created.creation.tutorModeMissing, ["claimTypology"]);
});

test("createAtsSession retries without a rejected context and keeps the tier", async () => {
    const bodies = [];
    const rejection = { error: "Invalid case context", errors: [{ path: "/", message: "x" }] };

    const created = await createAtsSession({
        metadata:             METADATA,
        serviceConfiguration: { llm_tier: "advanced" },
        caseContext:          CASE_CONTEXT,
        request:              async (body) => {
            bodies.push(body);
            if (bodies.length === 1) {
                throw badRequest(rejection);
            }
            return { session_id: "ats-2", llm_tier: "advanced", warnings: [] };
        },
    });

    assert.equal(bodies.length, 2);
    assert.equal(Object.hasOwn(bodies[1], "case_context"), false);
    assert.equal(bodies[1].llm_tier, "advanced");
    assert.equal(created.creation.caseContext, "rejected");
    assert.deepEqual(created.creation.caseContextRejection, rejection);
    assert.equal(created.creation.configurationRejected, false);
});

test("createAtsSession drops the tier first when the 400 does not name the context", async () => {
    const bodies = [];

    const created = await withoutWarnings(() => createAtsSession({
        metadata:             METADATA,
        serviceConfiguration: { llm_tier: "legacy" },
        caseContext:          CASE_CONTEXT,
        request:              async (body) => {
            bodies.push(body);
            if (bodies.length === 1) {
                throw badRequest({ error: "Invalid instance configuration", errors: { llm_tier: "x" } });
            }
            return { session_id: "ats-3", warnings: [], mode: "enhanced" };
        },
    }));

    assert.equal(bodies.length, 2);
    assert.equal(Object.hasOwn(bodies[1], "llm_tier"), false);
    assert.deepEqual(bodies[1].case_context, CASE_CONTEXT);
    assert.equal(created.creation.configurationRejected, true);
    assert.equal(created.creation.caseContext, "used");
});

test("createAtsSession gives up once nothing optional is left to drop", async () => {
    let calls = 0;
    await assert.rejects(createAtsSession({
        metadata:    METADATA,
        caseContext: CASE_CONTEXT,
        request:     async () => {
            calls += 1;
            throw badRequest({ error: "Missing required fields: question" });
        },
    }), /HTTP 400/u);

    assert.equal(calls, 2, "the context is dropped once, then the error is final");
});

test("sessionTutorMode: the decision, corrected by the tutor's answer", () => {
    const enhanced = { mode: "enhanced", reason: null, caseContext: CASE_CONTEXT };
    const basic = { mode: "basic", reason: "no-inventory", caseContext: null };

    assert.deepEqual(sessionTutorMode(basic, false, {}),
        { tutorMode: "basic", tutorModeReason: "no-inventory" });
    assert.deepEqual(sessionTutorMode(enhanced, true, { caseContext: "used" }),
        { tutorMode: "enhanced", tutorModeReason: null });
    assert.deepEqual(sessionTutorMode(enhanced, false, {}),
        { tutorMode: "basic", tutorModeReason: "tutor-unsupported" }, "withheld");
    assert.deepEqual(sessionTutorMode(enhanced, true, { caseContext: "unsupported" }),
        { tutorMode: "basic", tutorModeReason: "tutor-unsupported" });
    assert.deepEqual(sessionTutorMode(enhanced, true, { caseContext: "rejected" }),
        { tutorMode: "basic", tutorModeReason: "context-rejected" });
    assert.deepEqual(sessionTutorMode(enhanced, true, { caseContext: "downgraded" }),
        { tutorMode: "basic", tutorModeReason: "context-rejected" });
});

test("tutorEvaluationFromExternalResult reads the evaluation's mode and evidence", () => {
    assert.deepEqual(tutorEvaluationFromExternalResult({
        tutorMode:         "enhanced",
        evidenceFactIds:   ["EV1", "EV1", "AF2", " EV3 "],
        unsupportedClaims: [
            { statement: " She will be fired. ", exclusionId: "EX1" },
            { statement: "Not in the case.", exclusionId: null },
            { statement: "Wrong id.", exclusionId: "EV1" },
            { statement: "" },
        ],
    }), {
        tutorMode:         "enhanced",
        evidenceFactIds:   ["EV1", "EV3"],
        unsupportedClaims: [
            { statement: "She will be fired.", exclusionId: "EX1" },
            { statement: "Not in the case.", exclusionId: null },
            { statement: "Wrong id.", exclusionId: null },
        ],
    });
    assert.deepEqual(tutorEvaluationFromExternalResult({ payload: { feedback: { tutorMode: "basic" } } }),
        { tutorMode: "basic" });
    assert.equal(tutorEvaluationFromExternalResult({ tutorMode: "turbo" }), null);
    assert.equal(tutorEvaluationFromExternalResult({ summary: "No mode." }), null);
    assert.equal(tutorEvaluationFromExternalResult(null), null);
});

test("claimTypeFromExternalResult reads the matched claim type for teachers", () => {
    assert.deepEqual(
        claimTypeFromExternalResult({ claimTypeId: "AF2", claimTypeRationale: "  Argues for it. " }),
        { claimTypeId: "AF2", claimTypeRationale: "Argues for it." }
    );
    assert.deepEqual(
        claimTypeFromExternalResult({ payload: { feedback: { claimTypeId: null, claimTypeRationale: "None fits." } } }),
        { claimTypeId: null, claimTypeRationale: "None fits." }
    );
    assert.deepEqual(
        claimTypeFromExternalResult({ claimTypeId: "anything" }),
        { claimTypeId: null, claimTypeRationale: null }
    );
    assert.equal(claimTypeFromExternalResult({ summary: "No typology." }), null);
    assert.equal(claimTypeFromExternalResult(null), null);
});

test("the student's feedback does not carry the claim type", () => {
    const feedback = buildFeedbackPayloadFromExternalResult(
        { userId: 4, claimTypeId: "AF1", claimTypeRationale: "x", summary: "s" }, {}
    );

    assert.equal(JSON.stringify(feedback).includes("claimType"), false);
});

// ─── Plain texts (#768) ─────────────────────────────────────────────────────

test("the tutor receives Markdown instructions and questions as plain text", () => {
    const phaseDesign = {
        instructions:            "**Lee** el caso:\n\n- responde\n- justifica",
        instructionsContentType: "text/markdown",
        questions:               [
            { q_text: "  " },
            { q_text: "*¿Qué harías?*", q_text_content_type: "text/markdown" },
        ],
    };

    assert.equal(phaseInstructionsText(phaseDesign), "Lee el caso:\n\n- responde\n- justifica");
    assert.equal(questionTextFromPhaseDesign(phaseDesign), "¿Qué harías?");
    assert.equal(
        differentialQuestionText({ title: "**Uno**", title_content_type: "text/markdown" }), "Uno"
    );
});

test("texts without a Markdown content type reach the tutor as before", () => {
    const phaseDesign = { instructions: "  **Lee**  ", questions: [{ q_text: " *uno* " }] };

    assert.equal(phaseInstructionsText(phaseDesign), "**Lee**");
    assert.equal(questionTextFromPhaseDesign(phaseDesign), "*uno*");
    assert.equal(
        differentialQuestionText({ title: "**Uno**", title_content_type: null }), "**Uno**"
    );
    assert.equal(phaseInstructionsText(null), "");
    assert.equal(questionTextFromPhaseDesign({ questions: "invalid" }), "");
    assert.equal(differentialQuestionText(undefined), "");
});

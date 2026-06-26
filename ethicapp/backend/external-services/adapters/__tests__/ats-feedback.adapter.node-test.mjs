import assert from "node:assert/strict";
import test from "node:test";
import {
    buildArgumentClientContext,
    buildFeedbackPayloadFromAtsStatus,
    buildFeedbackPayloadFromExternalResult,
} from "../ats-feedback.utils.js";

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

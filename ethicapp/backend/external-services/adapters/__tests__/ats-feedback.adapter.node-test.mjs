import assert from "node:assert/strict";
import test from "node:test";
import { buildArgumentClientContext } from "../ats-feedback.adapter.js";

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

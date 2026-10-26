import assert from "node:assert/strict";
import test from "node:test";
import {
    CASE_CREATED_HOOK,
    buildCaseCreatedContext,
    dispatchCaseCreatedHook,
} from "../case-lifecycle-helper.js";

const CREATED_CASE = {
    id:            "42",
    case_uuid:     "0f1e2d3c-0000-4000-8000-000000000042",
    title:         "Autonomous vehicles",
    pdf_path:      "/uploads/cases/42/case.pdf",
    language_code: "es",
    visibility:    "private",
};

test("buildCaseCreatedContext: maps the inserted row and creator into the hook context", () => {
    const context = buildCaseCreatedContext(CREATED_CASE, { userId: "7", pdfRenderJobId: 99 });

    assert.deepEqual(context, {
        caseId:         42,
        caseUuid:       CREATED_CASE.case_uuid,
        userId:         7,
        title:          "Autonomous vehicles",
        pdfPath:        "/uploads/cases/42/case.pdf",
        languageCode:   "es",
        visibility:     "private",
        pdfRenderJobId: 99,
    });
});

test("buildCaseCreatedContext: nulls missing or invalid ids and defaults", () => {
    const context = buildCaseCreatedContext({ id: "not-a-number" });

    assert.equal(context.caseId, null);
    assert.equal(context.userId, null);
    assert.equal(context.pdfRenderJobId, null);
    assert.equal(context.title, null);
});

test("dispatchCaseCreatedHook: dispatches case-created through dispatchGlobalHook", async () => {
    const calls = [];
    const registry = {
        dispatchGlobalHook: async (hookName, context) => {
            calls.push({ hookName, context });
            return [{ status: "fulfilled", value: undefined }];
        },
    };

    const outcomes = await dispatchCaseCreatedHook({ caseId: 42 }, { registry });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].hookName, CASE_CREATED_HOOK);
    assert.deepEqual(calls[0].context, { caseId: 42 });
    assert.equal(outcomes.length, 1);
});

test("dispatchCaseCreatedHook: swallows registry errors and returns []", async () => {
    const originalError = console.error;
    const logged = [];
    console.error = (...args) => { logged.push(args); };

    try {
        const registry = {
            dispatchGlobalHook: async () => { throw new Error("registry down"); },
        };

        const outcomes = await dispatchCaseCreatedHook({ caseId: 42 }, { registry });

        assert.deepEqual(outcomes, []);
        assert.equal(logged.length, 1);
    } finally {
        console.error = originalError;
    }
});

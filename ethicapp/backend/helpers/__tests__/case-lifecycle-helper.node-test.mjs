import assert from "node:assert/strict";
import test from "node:test";
import {
    CASE_CREATED_HOOK,
    buildCaseCreatedContext,
    dispatchCaseCreatedHook,
    resolveCaseAnalysisServiceIds,
} from "../case-lifecycle-helper.js";

const RESERVED_JOB_IDS = [
    "c1d2e3f4-0000-4000-8000-000000000021",
    "c1d2e3f4-0000-4000-8000-000000000022",
];

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

test("dispatchCaseCreatedHook: dispatches only the reservations, under their job ids", async () => {
    const calls = [];
    const registry = {
        dispatchHook: async (hookName, context, options) => {
            calls.push({ hookName, context, options });
            return [{ status: "fulfilled", value: undefined }];
        },
    };
    const reservations = [
        { service_id: "svc-case", job_id: RESERVED_JOB_IDS[0], status: "requested" },
        { service_id: "svc-other", job_id: RESERVED_JOB_IDS[1], status: "requested" },
    ];

    const outcomes = await dispatchCaseCreatedHook({ caseId: 42 }, { reservations, registry });

    assert.deepEqual(calls, [{
        hookName: CASE_CREATED_HOOK,
        context:  { caseId: 42 },
        options:  {
            enabledServiceIds: ["svc-case", "svc-other"],
            jobIds:            {
                "svc-case":  RESERVED_JOB_IDS[0],
                "svc-other": RESERVED_JOB_IDS[1],
            },
        },
    }]);
    assert.equal(outcomes.length, 1);
});

test("dispatchCaseCreatedHook: dispatches nothing without reservations", async () => {
    let dispatched = false;
    const registry = {
        dispatchHook: async () => {
            dispatched = true;
            return [];
        },
    };

    assert.deepEqual(await dispatchCaseCreatedHook({ caseId: 42 }, { registry }), []);
    assert.deepEqual(
        await dispatchCaseCreatedHook({ caseId: 42 }, { reservations: [], registry }),
        []
    );
    assert.equal(dispatched, false);
});

test("dispatchCaseCreatedHook: swallows registry errors and returns []", async () => {
    const originalError = console.error;
    const logged = [];
    console.error = (...args) => { logged.push(args); };

    try {
        const registry = {
            dispatchHook: async () => { throw new Error("registry down"); },
        };

        const outcomes = await dispatchCaseCreatedHook({ caseId: 42 }, {
            reservations: [{ service_id: "svc-case", job_id: RESERVED_JOB_IDS[0] }],
            registry,
        });

        assert.deepEqual(outcomes, []);
        assert.equal(logged.length, 1);
    } finally {
        console.error = originalError;
    }
});

// ─── resolveCaseAnalysisServiceIds ───────────────────────────────────────────

function makeCaseRegistry(caseServiceIds) {
    const registry = {
        initialized:                  false,
        initialize:                   async () => { registry.initialized = true; },
        getEnabledServiceIdsForScope: scope => (scope === "case" ? caseServiceIds : []),
    };
    return registry;
}

test("resolveCaseAnalysisServiceIds: no choice is valid and skips the registry", async () => {
    for (const value of [undefined, null, "", "[]"]) {
        const registry = makeCaseRegistry(["svc-case"]);

        const choice = await resolveCaseAnalysisServiceIds(value, { registry });

        assert.deepEqual(choice, { serviceIds: [], valid: true }, JSON.stringify(value));
        assert.equal(registry.initialized, false);
    }
});

test("resolveCaseAnalysisServiceIds: accepts enabled case services once, trimmed", async () => {
    const registry = makeCaseRegistry(["svc-case", "svc-other-case"]);
    const chosen = JSON.stringify(["svc-case", " svc-case ", "svc-other-case"]);

    assert.deepEqual(
        await resolveCaseAnalysisServiceIds(chosen, { registry }),
        { serviceIds: ["svc-case", "svc-other-case"], valid: true }
    );
    assert.deepEqual(
        await resolveCaseAnalysisServiceIds(["svc-case"], { registry }),
        { serviceIds: ["svc-case"], valid: true }
    );
});

test("resolveCaseAnalysisServiceIds: rejects ids that are not enabled case services", async () => {
    const registry = makeCaseRegistry(["svc-case"]);

    const choice = await resolveCaseAnalysisServiceIds(
        JSON.stringify(["svc-case", "svc-chat"]),
        { registry }
    );

    assert.equal(choice.valid, false);
    assert.equal(registry.initialized, true);
});

test("resolveCaseAnalysisServiceIds: rejects values that are not a JSON list of ids", async () => {
    const registry = makeCaseRegistry(["svc-case"]);
    const invalidValues = [
        "svc-case",
        JSON.stringify({ id: "svc-case" }),
        JSON.stringify([1]),
        JSON.stringify([""]),
        JSON.stringify(["svc-case", null]),
    ];

    for (const value of invalidValues) {
        const choice = await resolveCaseAnalysisServiceIds(value, { registry });

        assert.equal(choice.valid, false, value);
    }
});

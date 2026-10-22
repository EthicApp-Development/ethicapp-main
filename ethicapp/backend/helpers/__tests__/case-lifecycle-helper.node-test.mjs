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

const RESERVATIONS = [
    { case_id: 42, service_id: "svc-case", job_id: RESERVED_JOB_IDS[0], status: "requested" },
    { case_id: 42, service_id: "svc-other", job_id: RESERVED_JOB_IDS[1], status: "requested" },
];

// Records the reservations released, in the order they are released.
function makeRelease({ error = null } = {}) {
    const released = [];
    const releaseReservation = async args => {
        released.push(args);
        if (error) {
            throw error;
        }
        return null;
    };

    return { released, releaseReservation };
}

async function withCapturedErrors(fn) {
    const originalError = console.error;
    const logged = [];
    console.error = (...args) => { logged.push(args); };

    try {
        await fn();
    } finally {
        console.error = originalError;
    }

    return logged;
}

test("dispatchCaseCreatedHook: one dispatch per reservation, then its release", async () => {
    const calls = [];
    const registry = {
        dispatchHook: async (hookName, context, options) => {
            calls.push({ hookName, context, options });
            return [{ status: "fulfilled", value: undefined }];
        },
    };
    const { released, releaseReservation } = makeRelease();

    const outcomes = await dispatchCaseCreatedHook({ caseId: 42 }, {
        reservations: RESERVATIONS,
        registry,
        releaseReservation,
    });

    assert.deepEqual(calls, RESERVATIONS.map(({ service_id: serviceId, job_id: jobId }) => ({
        hookName: CASE_CREATED_HOOK,
        context:  { caseId: 42 },
        options:  { enabledServiceIds: [serviceId], jobIds: { [serviceId]: jobId } },
    })));
    // The release only changes a reservation that its adapter did not start.
    assert.deepEqual(released, [
        { caseId: 42, serviceId: "svc-case", jobId: RESERVED_JOB_IDS[0] },
        { caseId: 42, serviceId: "svc-other", jobId: RESERVED_JOB_IDS[1] },
    ]);
    assert.equal(outcomes.length, 2);
});

test("dispatchCaseCreatedHook: releases each reservation when its handler settles", async () => {
    let finishSlowHandler;
    const slowHandler = new Promise(resolve => { finishSlowHandler = resolve; });
    const registry = {
        dispatchHook: async (hookName, context, { enabledServiceIds }) => {
            if (enabledServiceIds[0] === "svc-other") {
                await slowHandler;
            }
            return [{ status: "fulfilled", value: undefined }];
        },
    };
    const { released, releaseReservation } = makeRelease();

    const dispatched = dispatchCaseCreatedHook({ caseId: 42 }, {
        reservations: RESERVATIONS,
        registry,
        releaseReservation,
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(released.map(({ serviceId }) => serviceId), ["svc-case"]);

    finishSlowHandler();
    await dispatched;

    assert.deepEqual(released.map(({ serviceId }) => serviceId), ["svc-case", "svc-other"]);
});

test("dispatchCaseCreatedHook: releases after a dispatch error or without a handler", async () => {
    const registry = {
        dispatchHook: async (hookName, context, { enabledServiceIds }) => {
            if (enabledServiceIds[0] === "svc-case") {
                throw new Error("registry down");
            }
            // svc-other has no case-created handler.
            return [];
        },
    };
    const { released, releaseReservation } = makeRelease();
    let outcomes;

    const logged = await withCapturedErrors(async () => {
        outcomes = await dispatchCaseCreatedHook({ caseId: 42 }, {
            reservations: RESERVATIONS,
            registry,
            releaseReservation,
        });
    });

    assert.deepEqual(outcomes, []);
    assert.deepEqual(released.map(({ serviceId }) => serviceId).sort(), ["svc-case", "svc-other"]);
    assert.equal(logged.length, 1);
});

test("dispatchCaseCreatedHook: logs and swallows release errors", async () => {
    const registry = {
        dispatchHook: async () => [{ status: "fulfilled", value: undefined }],
    };
    const { releaseReservation } = makeRelease({ error: new Error("database down") });
    let outcomes;

    const logged = await withCapturedErrors(async () => {
        outcomes = await dispatchCaseCreatedHook({ caseId: 42 }, {
            reservations: [RESERVATIONS[0]],
            registry,
            releaseReservation,
        });
    });

    assert.equal(outcomes.length, 1);
    assert.equal(logged.length, 1);
});

test("dispatchCaseCreatedHook: dispatches and releases nothing without reservations", async () => {
    let dispatched = false;
    const registry = {
        dispatchHook: async () => {
            dispatched = true;
            return [];
        },
    };
    const { released, releaseReservation } = makeRelease();

    assert.deepEqual(
        await dispatchCaseCreatedHook({ caseId: 42 }, { registry, releaseReservation }),
        []
    );
    assert.deepEqual(
        await dispatchCaseCreatedHook({ caseId: 42 }, {
            reservations: [],
            registry,
            releaseReservation,
        }),
        []
    );
    assert.equal(dispatched, false);
    assert.deepEqual(released, []);
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

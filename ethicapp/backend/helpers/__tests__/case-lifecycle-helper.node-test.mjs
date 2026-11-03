import assert from "node:assert/strict";
import test from "node:test";
import {
    CASE_CREATED_HOOK,
    buildCaseCreatedContext,
    dispatchCaseCreatedHook,
    requestCaseAnalyses,
    requestCaseCopyAnalyses,
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
        initialized:                 false,
        initialize:                  async () => { registry.initialized = true; },
        getUsableServiceIdsForScope: scope => (scope === "case" ? caseServiceIds : []),
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

test("resolveCaseAnalysisServiceIds: accepts usable case services once, trimmed", async () => {
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

test("resolveCaseAnalysisServiceIds: rejects ids that are not usable case services", async () => {
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

// ─── services requested for an existing case (#1039) ─────────────────────────

/**
 * Fakes for requestCaseAnalyses: an insert that reserves the services the case
 * has not chosen (`chosen`), as ON CONFLICT DO NOTHING does, and a dispatch
 * that records its calls, or fails with `dispatchError`.
 */
function makeRequestDependencies({ chosen = [], dispatchError = null } = {}) {
    const calls = { inserted: [], dispatched: [] };
    const registry = makeCaseRegistry([]);

    return {
        calls,
        registry,
        dependencies: {
            registry,
            insertRequested: async (args) => {
                calls.inserted.push(args);
                return args.serviceIds
                    .filter(serviceId => !chosen.includes(serviceId))
                    .map(serviceId => ({
                        case_id:    args.caseId,
                        service_id: serviceId,
                        job_id:     `job-${serviceId}`,
                        status:     "requested",
                    }));
            },
            dispatch: async (context, options) => {
                calls.dispatched.push({ context, options });
                if (dispatchError) {
                    throw dispatchError;
                }
                return [{ status: "fulfilled", value: undefined }];
            },
        },
    };
}

const caseAnalysesRequest = (overrides = {}) => ({
    caseRow:        CREATED_CASE,
    serviceIds:     ["svc-chosen", "svc-new"],
    userId:         5,
    pdfRenderJobId: 77,
    ...overrides,
});

test("requestCaseAnalyses: reserves the services the case lacks and dispatches only them", async () => {
    const { calls, registry, dependencies } = makeRequestDependencies({ chosen: ["svc-chosen"] });

    const { reservations, dispatched } = await requestCaseAnalyses(
        caseAnalysesRequest(),
        dependencies
    );

    assert.deepEqual(calls.inserted, [{
        caseId:     42,
        serviceIds: ["svc-chosen", "svc-new"],
        userId:     5,
    }]);
    assert.deepEqual(reservations.map(row => row.service_id), ["svc-new"]);
    assert.equal((await dispatched).length, 1);
    assert.equal(calls.dispatched.length, 1);
    const [{ context, options }] = calls.dispatched;
    assert.deepEqual(
        context,
        buildCaseCreatedContext(CREATED_CASE, { userId: 5, pdfRenderJobId: 77 })
    );
    assert.deepEqual(options.reservations, reservations);
    assert.equal(options.registry, registry);
});

test("requestCaseAnalyses: dispatches nothing when every service is already chosen", async () => {
    const { calls, dependencies } = makeRequestDependencies({ chosen: ["svc-chosen", "svc-new"] });

    const { reservations, dispatched } = await requestCaseAnalyses(
        caseAnalysesRequest(),
        dependencies
    );

    assert.deepEqual(reservations, []);
    assert.deepEqual(await dispatched, []);
    assert.equal(calls.dispatched.length, 0);
});

test("requestCaseAnalyses: a failed dispatch is logged and never rejects", async () => {
    const { dependencies } = makeRequestDependencies({
        dispatchError: new Error("dispatch failed"),
    });

    let outcomes;
    const logged = await withCapturedErrors(async () => {
        const { reservations, dispatched } = await requestCaseAnalyses(
            caseAnalysesRequest(),
            dependencies
        );
        assert.equal(reservations.length, 2);
        outcomes = await dispatched;
    });

    assert.deepEqual(outcomes, []);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][1].caseId, 42);
    assert.equal(logged[0][1].error.message, "dispatch failed");
});

test("requestCaseAnalyses: rejects when the insert fails, before any dispatch", async () => {
    const { calls, dependencies } = makeRequestDependencies();
    dependencies.insertRequested = async () => {
        throw new Error("insert failed");
    };

    await assert.rejects(requestCaseAnalyses(caseAnalysesRequest(), dependencies), /insert failed/);
    assert.equal(calls.dispatched.length, 0);
});

// ─── copies of a case (#1038) ────────────────────────────────────────────────

const SOURCE_CASE_ID = 41;
const COPIED_CASE = { ...CREATED_CASE, id: 99, title: "Autonomous vehicles (copy)" };

/**
 * Fakes for requestCaseCopyAnalyses: the source's analyses, the case services
 * the policy allows, and an insert that reserves the requested services the
 * copy does not have yet (`inherited`), as ON CONFLICT DO NOTHING does.
 */
function makeCopyDependencies({
    sourceServiceIds = [],
    allowedServiceIds = [],
    inherited = [],
    failures = {},
} = {}) {
    const calls = { listed: [], inserted: [], dispatched: [] };
    const registry = makeCaseRegistry(allowedServiceIds);

    return {
        calls,
        registry,
        dependencies: {
            registry,
            listAnalyses: async caseId => {
                calls.listed.push(caseId);
                if (failures.list) {
                    throw failures.list;
                }
                return sourceServiceIds.map(serviceId => ({ case_id: caseId, service_id: serviceId }));
            },
            insertRequested: async args => {
                calls.inserted.push(args);
                if (failures.insert) {
                    throw failures.insert;
                }
                return args.serviceIds
                    .filter(serviceId => !inherited.includes(serviceId))
                    .map(serviceId => ({
                        case_id:    args.caseId,
                        service_id: serviceId,
                        job_id:     `job-${serviceId}`,
                        status:     "requested",
                    }));
            },
            dispatch: async (context, options) => {
                calls.dispatched.push({ context, options });
                if (failures.dispatch) {
                    throw failures.dispatch;
                }
                return [{ status: "fulfilled", value: undefined }];
            },
        },
    };
}

const copyRequest = (overrides = {}) => ({
    sourceCaseId:   SOURCE_CASE_ID,
    copiedCase:     COPIED_CASE,
    userId:         8,
    pdfRenderJobId: 77,
    ...overrides,
});

test("requestCaseCopyAnalyses: reserves the source's other choices for the copy and dispatches them", async () => {
    const { calls, registry, dependencies } = makeCopyDependencies({
        sourceServiceIds:  ["svc-ready", "svc-failed", "svc-processing"],
        allowedServiceIds: ["svc-ready", "svc-failed", "svc-processing"],
        inherited:         ["svc-ready"],
    });

    const outcomes = await requestCaseCopyAnalyses(copyRequest(), dependencies);

    assert.deepEqual(calls.listed, [SOURCE_CASE_ID]);
    assert.equal(registry.initialized, true);
    // The copying teacher requests them; the insert skips the inherited one.
    assert.deepEqual(calls.inserted, [{
        caseId:     99,
        serviceIds: ["svc-ready", "svc-failed", "svc-processing"],
        userId:     8,
    }]);
    assert.equal(calls.dispatched.length, 1);
    const [{ context, options }] = calls.dispatched;
    assert.deepEqual(context, buildCaseCreatedContext(COPIED_CASE, { userId: 8, pdfRenderJobId: 77 }));
    assert.deepEqual(
        options.reservations.map(reservation => reservation.service_id),
        ["svc-failed", "svc-processing"],
        "only the copy's new reservations are dispatched"
    );
    assert.equal(options.registry, registry);
    assert.equal(outcomes.length, 1);
});

test("requestCaseCopyAnalyses: leaves out services the current policy does not allow for cases", async () => {
    const { calls, dependencies } = makeCopyDependencies({
        sourceServiceIds:  ["svc-allowed", "svc-switched-off"],
        allowedServiceIds: ["svc-allowed"],
    });

    await requestCaseCopyAnalyses(copyRequest(), dependencies);

    assert.deepEqual(calls.inserted[0].serviceIds, ["svc-allowed"]);
    assert.deepEqual(
        calls.dispatched[0].options.reservations.map(reservation => reservation.service_id),
        ["svc-allowed"]
    );
});

test("requestCaseCopyAnalyses: dispatches nothing when every choice is inherited or not allowed", async () => {
    const inherited = makeCopyDependencies({
        sourceServiceIds:  ["svc-ready"],
        allowedServiceIds: ["svc-ready"],
        inherited:         ["svc-ready"],
    });
    assert.deepEqual(await requestCaseCopyAnalyses(copyRequest(), inherited.dependencies), []);
    assert.equal(inherited.calls.dispatched.length, 0);

    const notAllowed = makeCopyDependencies({ sourceServiceIds: ["svc-switched-off"] });
    assert.deepEqual(await requestCaseCopyAnalyses(copyRequest(), notAllowed.dependencies), []);
    assert.deepEqual(notAllowed.calls.inserted[0].serviceIds, []);
    assert.equal(notAllowed.calls.dispatched.length, 0);
});

test("requestCaseCopyAnalyses: a source without chosen services requests nothing", async () => {
    const { calls, registry, dependencies } = makeCopyDependencies({
        allowedServiceIds: ["svc-case"],
    });

    assert.deepEqual(await requestCaseCopyAnalyses(copyRequest(), dependencies), []);
    assert.equal(registry.initialized, false, "the registry is not read");
    assert.equal(calls.inserted.length, 0);
    assert.equal(calls.dispatched.length, 0);
});

test("requestCaseCopyAnalyses: never rejects, and logs what failed", async () => {
    for (const step of ["list", "insert", "dispatch"]) {
        const { dependencies } = makeCopyDependencies({
            sourceServiceIds:  ["svc-case"],
            allowedServiceIds: ["svc-case"],
            failures:          { [step]: new Error(`${step} failed`) },
        });

        let outcomes;
        const logged = await withCapturedErrors(async () => {
            outcomes = await requestCaseCopyAnalyses(copyRequest(), dependencies);
        });

        assert.deepEqual(outcomes, [], step);
        assert.equal(logged.length, 1, step);
        assert.equal(logged[0][1].error.message, `${step} failed`);
        assert.equal(logged[0][1].caseId, 99);
    }
});

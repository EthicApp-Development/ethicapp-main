import assert from "node:assert/strict";
import test from "node:test";

import { NON_SESSION_HOOKS } from "../../services/external-services.service.js";
import {
    DESIGN_SAVED_HOOK,
    buildDesignSavedContext,
    dispatchDesignSavedHook,
    requestDesignAnalysesOnSave,
    resolveDesignAnalysisInput,
    scheduleDesignAnalysesOnSave,
} from "../design-analyses-lifecycle-helper.js";

const JOB_ID = "f1a2b3c4-0000-4000-8000-000000000071";

const DESIGN_ROW = {
    id:                 "5",
    creator:            3,
    case_id:            42,
    case_language_code: "es",
    locked:             false,
    design:             { phases: [{ type: "semantic_differential" }] },
};

test("design-saved fires outside sessions, under the current policy version", () => {
    assert.equal(DESIGN_SAVED_HOOK, "design-saved");
    assert.ok(NON_SESSION_HOOKS.includes(DESIGN_SAVED_HOOK));
});

test("buildDesignSavedContext: maps the design row into the hook context", () => {
    assert.deepEqual(buildDesignSavedContext(DESIGN_ROW, { userId: "7" }), {
        designId:      5,
        userId:        7,
        caseId:        42,
        languageCode:  "es",
        design:        DESIGN_ROW.design,
        analysisInput: null,
        inputHash:     null,
    });
    assert.equal(buildDesignSavedContext(DESIGN_ROW).userId, 3, "the creator by default");
});

test("buildDesignSavedContext: carries the adapter's input and its hash", () => {
    const context = buildDesignSavedContext(DESIGN_ROW, {
        analysis: { input: { questions: [] }, hash: "sha256:abc" },
    });

    assert.deepEqual(context.analysisInput, { questions: [] });
    assert.equal(context.inputHash, "sha256:abc");
});

test("buildDesignSavedContext: nulls a missing case and invalid ids", () => {
    assert.deepEqual(buildDesignSavedContext({ id: "x" }), {
        designId:      null,
        userId:        null,
        caseId:        null,
        languageCode:  null,
        design:        null,
        analysisInput: null,
        inputHash:     null,
    });
});

test("dispatchDesignSavedHook: dispatches each reservation under its job, then releases it", async () => {
    const calls = [];
    const released = [];
    const registry = {
        dispatchHook: async (hookName, context, options) => {
            calls.push({ hookName, context, options });
            return [{ status: "fulfilled", value: undefined }];
        },
    };

    const outcomes = await dispatchDesignSavedHook({ designId: 5 }, {
        reservations:       [{ design_id: 5, service_id: "svc-design", job_id: JOB_ID }],
        registry,
        releaseReservation: async args => { released.push(args); },
    });

    assert.deepEqual(calls, [{
        hookName: "design-saved",
        context:  { designId: 5 },
        options:  { enabledServiceIds: ["svc-design"], jobIds: { "svc-design": JOB_ID } },
    }]);
    assert.deepEqual(released, [{ designId: 5, serviceId: "svc-design", jobId: JOB_ID }]);
    assert.equal(outcomes.length, 1);
});

test("dispatchDesignSavedHook: a failed dispatch is logged and the reservation released", async () => {
    const released = [];
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => { logged.push(args); };

    try {
        const outcomes = await dispatchDesignSavedHook({ designId: 5 }, {
            reservations:       [{ design_id: 5, service_id: "svc-design", job_id: JOB_ID }],
            registry:           { dispatchHook: async () => { throw new Error("boom"); } },
            releaseReservation: async args => { released.push(args); },
        });
        assert.deepEqual(outcomes, []);
    } finally {
        console.error = originalError;
    }

    assert.equal(released.length, 1);
    assert.match(logged[0][0], /Error dispatching design-saved hook/);
});

test("dispatchDesignSavedHook: nothing is dispatched without reservations", async () => {
    const registry = { dispatchHook: async () => assert.fail("no dispatch expected") };

    assert.deepEqual(await dispatchDesignSavedHook({ designId: 5 }, { registry }), []);
});

// ─── analyses on save (#848) ─────────────────────────────────────────────────

const SAVED_ROW = {
    ...DESIGN_ROW,
    id:                 5,
    design:             { valid: true, type: "semantic_differential", phases: [] },
    design_fingerprint: "fingerprint-1",
};

const DESIGN_CASE = { id: 42, title: "A case", languageCode: "es", contentHash: "sha256:pdf" };

// The stored analyses, by service id ({ input_hash, status, error_code,
// is_stale, job_id }), reserved with the rule of
// reserveDesignAnalysisForSavedInput(), whose SQL runs against PostgreSQL in
// design-analyses.integration-test.mjs.
function makeStore(rows = {}) {
    let jobCounter = 0;
    const reserved = [];
    const snapshots = [];
    // The stored design's fingerprint, which a later save may change.
    const currentDesign = { fingerprint: SAVED_ROW.design_fingerprint };

    const covered = row => (["requested", "processing"].includes(row.status) && !row.is_stale)
        || (row.status === "ready" && !row.error_code);

    const reserve = async ({ designId, serviceId, inputHash, userId, designSnapshot }) => {
        snapshots.push(designSnapshot);
        if (designSnapshot.fingerprint !== currentDesign.fingerprint) {
            return { designChanged: true, reservation: null };
        }

        const row = rows[serviceId];
        if (row && row.input_hash === inputHash && covered(row)) {
            return { designChanged: false, reservation: null };
        }

        jobCounter += 1;
        const jobId = `job-${serviceId}-${jobCounter}`;
        rows[serviceId] = {
            ...row,
            input_hash: inputHash,
            status:     "requested",
            error_code: null,
            is_stale:   false,
            job_id:     jobId,
        };
        reserved.push({ designId, serviceId, inputHash, userId });
        return {
            designChanged: false,
            reservation:   { design_id: designId, service_id: serviceId, job_id: jobId, status: "requested" },
        };
    };

    return { rows, reserve, reserved, snapshots, currentDesign };
}

// A registry whose design-scoped services are `inputs`: service id ->
// designAnalysisInput(), or null for a service without the export.
function makeRegistry(inputs, { usable = Object.keys(inputs) } = {}) {
    return {
        initialized: false,
        async initialize() {
            this.initialized = true;
        },
        getUsableServiceIdsForScope:   async scope => (scope === "design" ? usable : []),
        getDesignAnalysisInputBuilder: serviceId => inputs[serviceId] ?? null,
    };
}

function makeSaveDependencies({
    designRow = SAVED_ROW,
    designCase = DESIGN_CASE,
    inputs = { "svc-design": () => ({ input: { q: 1 }, hash: "sha256:one" }) },
    usable,
    store = makeStore(),
} = {}) {
    const dispatched = [];
    const caseLoads = [];

    return {
        store,
        dispatched,
        caseLoads,
        dependencies: {
            getDesignRow: async () => designRow,
            loadCase:     async caseId => {
                caseLoads.push(caseId);
                return designCase;
            },
            registry: makeRegistry(inputs, { usable }),
            reserve:  store.reserve,
            dispatch: async (context, { reservations }) => {
                dispatched.push({ context, reservations });
                return [];
            },
        },
    };
}

test("requestDesignAnalysesOnSave: a valid design with a case requests each applicable service", async () => {
    const received = [];
    const { dependencies, dispatched, store } = makeSaveDependencies({
        inputs: {
            "svc-a": args => {
                received.push(args);
                return { input: { questions: ["a"] }, hash: "sha256:a" };
            },
            "svc-b": () => ({ input: { questions: ["b"] }, hash: "sha256:b" }),
        },
    });

    const result = await requestDesignAnalysesOnSave(5, { userId: 7, dependencies });

    assert.equal(result.skipped, null);
    assert.deepEqual(result.services.map(({ serviceId, outcome }) => [serviceId, outcome]), [
        ["svc-a", "requested"],
        ["svc-b", "requested"],
    ]);
    assert.deepEqual(received, [{ design: SAVED_ROW.design, designCase: DESIGN_CASE }]);
    assert.deepEqual(store.reserved, [
        { designId: 5, serviceId: "svc-a", inputHash: "sha256:a", userId: 7 },
        { designId: 5, serviceId: "svc-b", inputHash: "sha256:b", userId: 7 },
    ]);
    assert.deepEqual(dispatched.map(({ context, reservations }) => [
        reservations.map(reservation => reservation.service_id),
        context.designId,
        context.userId,
        context.analysisInput,
        context.inputHash,
    ]), [
        [["svc-a"], 5, 7, { questions: ["a"] }, "sha256:a"],
        [["svc-b"], 5, 7, { questions: ["b"] }, "sha256:b"],
    ]);
});

test("requestDesignAnalysesOnSave: the requester is the creator by default", async () => {
    const { dependencies, store } = makeSaveDependencies();

    await requestDesignAnalysesOnSave(5, { dependencies });

    assert.equal(store.reserved[0].userId, 3);
});

test("requestDesignAnalysesOnSave: an unchanged input runs nothing, a changed one runs again", async () => {
    let hash = "sha256:first";
    const store = makeStore();
    const { dependencies, dispatched } = makeSaveDependencies({
        store,
        inputs: { "svc-design": () => ({ input: {}, hash }) },
    });

    await requestDesignAnalysesOnSave(5, { dependencies });
    store.rows["svc-design"].status = "ready";

    const unchanged = await requestDesignAnalysesOnSave(5, { dependencies });
    assert.deepEqual(unchanged.services, [{ serviceId: "svc-design", outcome: "unchanged" }]);
    assert.equal(dispatched.length, 1);

    hash = "sha256:second";
    const changed = await requestDesignAnalysesOnSave(5, { dependencies });
    assert.equal(changed.services[0].outcome, "requested");
    assert.equal(dispatched.length, 2);
    assert.equal(dispatched[1].context.inputHash, "sha256:second");
});

test("requestDesignAnalysesOnSave: the same input in flight is not duplicated; a changed one supersedes it", async () => {
    let hash = "sha256:first";
    const store = makeStore();
    const { dependencies, dispatched } = makeSaveDependencies({
        store,
        inputs: { "svc-design": () => ({ input: {}, hash }) },
    });

    const first = await requestDesignAnalysesOnSave(5, { dependencies });
    store.rows["svc-design"].status = "processing";

    const same = await requestDesignAnalysesOnSave(5, { dependencies });
    assert.equal(same.services[0].outcome, "unchanged");

    hash = "sha256:second";
    const superseding = await requestDesignAnalysesOnSave(5, { dependencies });
    assert.equal(superseding.services[0].outcome, "requested");
    assert.notEqual(superseding.services[0].jobId, first.services[0].jobId);
    assert.equal(store.rows["svc-design"].job_id, superseding.services[0].jobId);
    assert.equal(dispatched.length, 2);
});

test("requestDesignAnalysesOnSave: a failed generation of the same input runs again", async () => {
    const store = makeStore({
        "svc-design": { input_hash: "sha256:one", status: "ready", error_code: "timeout" },
    });
    const { dependencies } = makeSaveDependencies({ store });

    const result = await requestDesignAnalysesOnSave(5, { dependencies });

    assert.equal(result.services[0].outcome, "requested");
});

test("requestDesignAnalysesOnSave: reservations are bound to the design row that was read", async () => {
    const { dependencies, store } = makeSaveDependencies();

    await requestDesignAnalysesOnSave(5, { dependencies });

    assert.deepEqual(store.snapshots, [{ fingerprint: "fingerprint-1", caseId: 42 }]);
});

test("requestDesignAnalysesOnSave: a save overtaken by a newer save reserves and dispatches nothing", async () => {
    const store = makeStore();
    let releaseCase;
    const caseGate = new Promise(resolve => { releaseCase = resolve; });
    const { dependencies, dispatched } = makeSaveDependencies({ store });
    dependencies.loadCase = async () => {
        await caseGate;
        return DESIGN_CASE;
    };

    const olderSave = requestDesignAnalysesOnSave(5, { dependencies });
    // A newer save stores another design while the older one loads its case.
    store.currentDesign.fingerprint = "fingerprint-2";
    releaseCase();

    const result = await olderSave;
    assert.deepEqual(result.services, [{ serviceId: "svc-design", outcome: "design-changed" }]);
    assert.deepEqual(store.reserved, []);
    assert.deepEqual(dispatched, []);
});

test("requestDesignAnalysesOnSave: invalid, locked, case-less and missing designs request nothing", async () => {
    const cases = [
        ["invalid", { ...SAVED_ROW, design: { ...SAVED_ROW.design, valid: false } }],
        ["invalid", { ...SAVED_ROW, design: { phases: [] } }],
        ["locked", { ...SAVED_ROW, locked: true }],
        ["no-case", { ...SAVED_ROW, case_id: null }],
        ["not-found", null],
    ];

    for (const [reason, designRow] of cases) {
        const { dependencies, dispatched, store, caseLoads } = makeSaveDependencies({ designRow });

        const result = await requestDesignAnalysesOnSave(5, { dependencies });

        assert.deepEqual(result, { skipped: reason, services: [] }, reason);
        assert.equal(dependencies.registry.initialized, false, reason);
        assert.deepEqual(caseLoads, [], reason);
        assert.deepEqual(store.reserved, [], reason);
        assert.deepEqual(dispatched, [], reason);
    }
});

test("requestDesignAnalysesOnSave: a JSON string design document is parsed", async () => {
    const { dependencies } = makeSaveDependencies({
        designRow: { ...SAVED_ROW, design: JSON.stringify(SAVED_ROW.design) },
    });

    const result = await requestDesignAnalysesOnSave(5, { dependencies });

    assert.equal(result.services[0].outcome, "requested");
});

test("requestDesignAnalysesOnSave: no usable service with an input export requests nothing", async () => {
    const noneUsable = makeSaveDependencies({ usable: [] });
    const noExport = makeSaveDependencies({ inputs: { "svc-no-export": null } });

    for (const { dependencies, store, caseLoads } of [noneUsable, noExport]) {
        const result = await requestDesignAnalysesOnSave(5, { dependencies });

        assert.deepEqual(result, { skipped: "no-services", services: [] });
        assert.deepEqual(caseLoads, [], "the case is not read");
        assert.deepEqual(store.reserved, []);
    }
});

test("requestDesignAnalysesOnSave: an adapter that declines or fails reserves nothing", async () => {
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => { logged.push(args); };

    let result;
    let store;
    try {
        const setup = makeSaveDependencies({
            inputs: {
                "svc-declines": () => null,
                "svc-throws":   () => { throw new Error("boom"); },
                "svc-no-hash":  () => ({ input: {} }),
                "svc-applies":  () => ({ input: {}, hash: "sha256:ok" }),
            },
        });
        store = setup.store;
        result = await requestDesignAnalysesOnSave(5, { dependencies: setup.dependencies });
    } finally {
        console.error = originalError;
    }

    assert.deepEqual(result.services.map(({ serviceId, outcome }) => [serviceId, outcome]), [
        ["svc-declines", "not-applicable"],
        ["svc-throws", "error"],
        ["svc-no-hash", "error"],
        ["svc-applies", "requested"],
    ]);
    assert.deepEqual(store.reserved.map(({ serviceId }) => serviceId), ["svc-applies"]);
    assert.equal(logged.length, 2);
});

test("scheduleDesignAnalysesOnSave: returns before the analyses are requested", async () => {
    const calls = [];
    let release;
    const settled = new Promise(resolve => { release = resolve; });

    const returned = scheduleDesignAnalysesOnSave(5, {
        userId:  7,
        request: async (designId, options) => {
            calls.push({ designId, options });
            await settled;
        },
    });

    assert.equal(returned, undefined);
    assert.deepEqual(calls, [], "nothing runs before the current request answers");

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [{ designId: 5, options: { userId: 7 } }]);
    release();
});

test("scheduleDesignAnalysesOnSave: errors are logged, never thrown", async () => {
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => { logged.push(args); };

    try {
        scheduleDesignAnalysesOnSave(5, { request: async () => { throw new Error("boom"); } });
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
    } finally {
        console.error = originalError;
    }

    assert.equal(logged.length, 1);
    assert.match(logged[0][0], /Could not request the analyses of design 5/);
});

// ─── explicit generation input ───────────────────────────────────────────────

test("resolveDesignAnalysisInput: the adapter's input, or no hash without an export", async () => {
    const loads = [];
    const loadCase = async caseId => {
        loads.push(caseId);
        return DESIGN_CASE;
    };
    const registry = makeRegistry({
        "svc-design":   ({ designCase }) => ({ input: { caseId: designCase.id }, hash: "sha256:x" }),
        "svc-declines": () => null,
    });

    assert.deepEqual(
        await resolveDesignAnalysisInput(SAVED_ROW, "svc-design", { registry, loadCase }),
        { input: { caseId: 42 }, hash: "sha256:x" }
    );
    assert.equal(await resolveDesignAnalysisInput(SAVED_ROW, "svc-declines", { registry, loadCase }), null);
    assert.deepEqual(
        await resolveDesignAnalysisInput(SAVED_ROW, "svc-no-export", { registry, loadCase }),
        { input: null, hash: null }
    );
    assert.deepEqual(loads, [42, 42], "the case is read only for adapters with an export");
});

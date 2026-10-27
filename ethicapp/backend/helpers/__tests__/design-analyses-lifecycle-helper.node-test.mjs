import assert from "node:assert/strict";
import test from "node:test";

import { NON_SESSION_HOOKS } from "../../services/external-services.service.js";
import {
    buildDesignHookContext,
    dispatchDesignHook,
    requestDesignAnalyses,
    resolveDesignAnalysisInput,
    scheduleDesignAnalyses,
} from "../design-analyses-lifecycle-helper.js";
import {
    DESIGN_ANALYSIS_HOOKS,
    DESIGN_CREATED_HOOK,
    DESIGN_HOOK_TRIGGERS,
    DESIGN_UPDATED_HOOK,
    designHookForTrigger,
} from "../design-analysis-hooks.js";

const JOB_ID = "f1a2b3c4-0000-4000-8000-000000000071";

const DESIGN_ROW = {
    id:                 "5",
    creator:            3,
    case_id:            42,
    case_language_code: "es",
    locked:             false,
    design:             { phases: [{ type: "semantic_differential" }] },
};

test("the design hooks fire outside sessions, under the current policy version", () => {
    assert.equal(DESIGN_CREATED_HOOK, "design-created");
    assert.equal(DESIGN_UPDATED_HOOK, "design-updated");
    assert.deepEqual(DESIGN_ANALYSIS_HOOKS, ["design-created", "design-updated"]);
    assert.deepEqual(NON_SESSION_HOOKS, ["case-created", "design-created", "design-updated"]);
});

test("designHookForTrigger: created sends design-created, the others design-updated", () => {
    assert.deepEqual(DESIGN_HOOK_TRIGGERS, {
        CREATED:  "created",
        UPDATED:  "updated",
        GENERATE: "generate",
    });
    assert.equal(designHookForTrigger("created"), "design-created");
    assert.equal(designHookForTrigger("updated"), "design-updated");
    assert.equal(designHookForTrigger("generate"), "design-updated");
    for (const trigger of [undefined, null, "saved", "toString"]) {
        assert.throws(() => designHookForTrigger(trigger), TypeError, String(trigger));
    }
});

test("buildDesignHookContext: maps the design row into the hook context", () => {
    assert.deepEqual(buildDesignHookContext(DESIGN_ROW, { trigger: "updated", userId: "7" }), {
        trigger:       "updated",
        designId:      5,
        userId:        7,
        caseId:        42,
        languageCode:  "es",
        design:        DESIGN_ROW.design,
        analysisInput: null,
        inputHash:     null,
    });
    assert.equal(
        buildDesignHookContext(DESIGN_ROW, { trigger: "created" }).userId,
        3,
        "the creator by default"
    );
});

test("buildDesignHookContext: carries the adapter's input and its hash", () => {
    const context = buildDesignHookContext(DESIGN_ROW, {
        trigger:  "generate",
        analysis: { input: { questions: [] }, hash: "sha256:abc" },
    });

    assert.equal(context.trigger, "generate");
    assert.deepEqual(context.analysisInput, { questions: [] });
    assert.equal(context.inputHash, "sha256:abc");
});

test("buildDesignHookContext: nulls a missing case and invalid ids", () => {
    assert.deepEqual(buildDesignHookContext({ id: "x" }, { trigger: "created" }), {
        trigger:       "created",
        designId:      null,
        userId:        null,
        caseId:        null,
        languageCode:  null,
        design:        null,
        analysisInput: null,
        inputHash:     null,
    });
});

test("buildDesignHookContext: refuses an unknown trigger", () => {
    assert.throws(() => buildDesignHookContext(DESIGN_ROW), TypeError);
    assert.throws(() => buildDesignHookContext(DESIGN_ROW, { trigger: "saved" }), TypeError);
});

function recordingRegistry(calls) {
    return {
        dispatchHook: async (hookName, context, options) => {
            calls.push({ hookName, context, options });
            return [{ status: "fulfilled", value: undefined }];
        },
    };
}

test("dispatchDesignHook: dispatches each reservation under its job, then releases it", async () => {
    const calls = [];
    const released = [];

    const outcomes = await dispatchDesignHook({ trigger: "updated", designId: 5 }, {
        reservations:       [{ design_id: 5, service_id: "svc-design", job_id: JOB_ID }],
        registry:           recordingRegistry(calls),
        releaseReservation: async args => { released.push(args); },
    });

    assert.deepEqual(calls, [{
        hookName: "design-updated",
        context:  { trigger: "updated", designId: 5 },
        options:  { enabledServiceIds: ["svc-design"], jobIds: { "svc-design": JOB_ID } },
    }]);
    assert.deepEqual(released, [{ designId: 5, serviceId: "svc-design", jobId: JOB_ID }]);
    assert.equal(outcomes.length, 1);
});

test("dispatchDesignHook: the trigger selects the hook", async () => {
    const calls = [];
    const options = {
        reservations:       [{ design_id: 5, service_id: "svc-design", job_id: JOB_ID }],
        registry:           recordingRegistry(calls),
        releaseReservation: async () => {},
    };

    for (const trigger of ["created", "updated", "generate"]) {
        await dispatchDesignHook({ trigger, designId: 5 }, options);
    }

    assert.deepEqual(
        calls.map(({ hookName, context }) => [context.trigger, hookName]),
        [
            ["created", "design-created"],
            ["updated", "design-updated"],
            ["generate", "design-updated"],
        ]
    );
});

test("dispatchDesignHook: a failed dispatch is logged and the reservation released", async () => {
    const released = [];
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => { logged.push(args); };

    try {
        const outcomes = await dispatchDesignHook({ trigger: "created", designId: 5 }, {
            reservations:       [{ design_id: 5, service_id: "svc-design", job_id: JOB_ID }],
            registry:           { dispatchHook: async () => { throw new Error("boom"); } },
            releaseReservation: async args => { released.push(args); },
        });
        assert.deepEqual(outcomes, []);
    } finally {
        console.error = originalError;
    }

    assert.equal(released.length, 1);
    assert.match(logged[0][0], /Error dispatching design-created hook/);
});

test("dispatchDesignHook: nothing is dispatched without reservations", async () => {
    const registry = { dispatchHook: async () => assert.fail("no dispatch expected") };

    const context = { trigger: "updated", designId: 5 };
    assert.deepEqual(await dispatchDesignHook(context, { registry }), []);
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

test("requestDesignAnalyses: a valid design with a case requests each applicable service", async () => {
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

    const result = await requestDesignAnalyses(5, { trigger: "updated", userId: 7, dependencies });

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
        context.trigger,
        context.designId,
        context.userId,
        context.analysisInput,
        context.inputHash,
    ]), [
        [["svc-a"], "updated", 5, 7, { questions: ["a"] }, "sha256:a"],
        [["svc-b"], "updated", 5, 7, { questions: ["b"] }, "sha256:b"],
    ]);
});

test("requestDesignAnalyses: a created design dispatches with the created trigger", async () => {
    const { dependencies, dispatched } = makeSaveDependencies();

    const result = await requestDesignAnalyses(5, { trigger: "created", dependencies });

    assert.equal(result.services[0].outcome, "requested");
    assert.deepEqual(dispatched.map(({ context }) => context.trigger), ["created"]);
});

test("requestDesignAnalyses: refuses a trigger other than created or updated", async () => {
    for (const trigger of [undefined, "generate", "saved"]) {
        const { dependencies, store } = makeSaveDependencies();
        let read = false;
        dependencies.getDesignRow = async () => {
            read = true;
            return SAVED_ROW;
        };

        await assert.rejects(requestDesignAnalyses(5, { trigger, dependencies }), TypeError);
        assert.equal(read, false, String(trigger));
        assert.deepEqual(store.reserved, [], String(trigger));
    }
});

test("requestDesignAnalyses: the requester is the creator by default", async () => {
    const { dependencies, store } = makeSaveDependencies();

    await requestDesignAnalyses(5, { trigger: "updated", dependencies });

    assert.equal(store.reserved[0].userId, 3);
});

test("requestDesignAnalyses: an unchanged input runs nothing, a changed one runs again", async () => {
    let hash = "sha256:first";
    const store = makeStore();
    const { dependencies, dispatched } = makeSaveDependencies({
        store,
        inputs: { "svc-design": () => ({ input: {}, hash }) },
    });

    await requestDesignAnalyses(5, { trigger: "updated", dependencies });
    store.rows["svc-design"].status = "ready";

    const unchanged = await requestDesignAnalyses(5, { trigger: "updated", dependencies });
    assert.deepEqual(unchanged.services, [{ serviceId: "svc-design", outcome: "unchanged" }]);
    assert.equal(dispatched.length, 1);

    hash = "sha256:second";
    const changed = await requestDesignAnalyses(5, { trigger: "updated", dependencies });
    assert.equal(changed.services[0].outcome, "requested");
    assert.equal(dispatched.length, 2);
    assert.equal(dispatched[1].context.inputHash, "sha256:second");
});

test("requestDesignAnalyses: the same input in flight is not duplicated; a changed one supersedes it", async () => {
    let hash = "sha256:first";
    const store = makeStore();
    const { dependencies, dispatched } = makeSaveDependencies({
        store,
        inputs: { "svc-design": () => ({ input: {}, hash }) },
    });

    const first = await requestDesignAnalyses(5, { trigger: "updated", dependencies });
    store.rows["svc-design"].status = "processing";

    const same = await requestDesignAnalyses(5, { trigger: "updated", dependencies });
    assert.equal(same.services[0].outcome, "unchanged");

    hash = "sha256:second";
    const superseding = await requestDesignAnalyses(5, { trigger: "updated", dependencies });
    assert.equal(superseding.services[0].outcome, "requested");
    assert.notEqual(superseding.services[0].jobId, first.services[0].jobId);
    assert.equal(store.rows["svc-design"].job_id, superseding.services[0].jobId);
    assert.equal(dispatched.length, 2);
});

test("requestDesignAnalyses: a failed generation of the same input runs again", async () => {
    const store = makeStore({
        "svc-design": { input_hash: "sha256:one", status: "ready", error_code: "timeout" },
    });
    const { dependencies } = makeSaveDependencies({ store });

    const result = await requestDesignAnalyses(5, { trigger: "updated", dependencies });

    assert.equal(result.services[0].outcome, "requested");
});

test("requestDesignAnalyses: reservations are bound to the design row that was read", async () => {
    const { dependencies, store } = makeSaveDependencies();

    await requestDesignAnalyses(5, { trigger: "updated", dependencies });

    assert.deepEqual(store.snapshots, [{ fingerprint: "fingerprint-1", caseId: 42 }]);
});

test("requestDesignAnalyses: a save overtaken by a newer save reserves and dispatches nothing", async () => {
    const store = makeStore();
    let releaseCase;
    const caseGate = new Promise(resolve => { releaseCase = resolve; });
    const { dependencies, dispatched } = makeSaveDependencies({ store });
    dependencies.loadCase = async () => {
        await caseGate;
        return DESIGN_CASE;
    };

    const olderSave = requestDesignAnalyses(5, { trigger: "updated", dependencies });
    // A newer save stores another design while the older one loads its case.
    store.currentDesign.fingerprint = "fingerprint-2";
    releaseCase();

    const result = await olderSave;
    assert.deepEqual(result.services, [{ serviceId: "svc-design", outcome: "design-changed" }]);
    assert.deepEqual(store.reserved, []);
    assert.deepEqual(dispatched, []);
});

test("requestDesignAnalyses: invalid, locked, case-less and missing designs request nothing", async () => {
    const cases = [
        ["invalid", { ...SAVED_ROW, design: { ...SAVED_ROW.design, valid: false } }],
        ["invalid", { ...SAVED_ROW, design: { phases: [] } }],
        ["locked", { ...SAVED_ROW, locked: true }],
        ["no-case", { ...SAVED_ROW, case_id: null }],
        ["not-found", null],
    ];

    for (const [reason, designRow] of cases) {
        const { dependencies, dispatched, store, caseLoads } = makeSaveDependencies({ designRow });

        const result = await requestDesignAnalyses(5, { trigger: "updated", dependencies });

        assert.deepEqual(result, { skipped: reason, services: [] }, reason);
        assert.equal(dependencies.registry.initialized, false, reason);
        assert.deepEqual(caseLoads, [], reason);
        assert.deepEqual(store.reserved, [], reason);
        assert.deepEqual(dispatched, [], reason);
    }
});

test("requestDesignAnalyses: a JSON string design document is parsed", async () => {
    const { dependencies } = makeSaveDependencies({
        designRow: { ...SAVED_ROW, design: JSON.stringify(SAVED_ROW.design) },
    });

    const result = await requestDesignAnalyses(5, { trigger: "updated", dependencies });

    assert.equal(result.services[0].outcome, "requested");
});

test("requestDesignAnalyses: no usable service with an input export requests nothing", async () => {
    const noneUsable = makeSaveDependencies({ usable: [] });
    const noExport = makeSaveDependencies({ inputs: { "svc-no-export": null } });

    for (const { dependencies, store, caseLoads } of [noneUsable, noExport]) {
        const result = await requestDesignAnalyses(5, { trigger: "updated", dependencies });

        assert.deepEqual(result, { skipped: "no-services", services: [] });
        assert.deepEqual(caseLoads, [], "the case is not read");
        assert.deepEqual(store.reserved, []);
    }
});

test("requestDesignAnalyses: an adapter that declines or fails reserves nothing", async () => {
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
        result = await requestDesignAnalyses(5, {
            trigger:      "updated",
            dependencies: setup.dependencies,
        });
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

test("scheduleDesignAnalyses: returns before the analyses are requested", async () => {
    const calls = [];
    let release;
    const settled = new Promise(resolve => { release = resolve; });

    const returned = scheduleDesignAnalyses(5, {
        trigger: "created",
        userId:  7,
        request: async (designId, options) => {
            calls.push({ designId, options });
            await settled;
        },
    });

    assert.equal(returned, undefined);
    assert.deepEqual(calls, [], "nothing runs before the current request answers");

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [{ designId: 5, options: { trigger: "created", userId: 7 } }]);
    release();
});

test("scheduleDesignAnalyses: errors are logged, never thrown", async () => {
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => { logged.push(args); };

    try {
        scheduleDesignAnalyses(5, {
            trigger: "updated",
            request: async () => { throw new Error("boom"); },
        });
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

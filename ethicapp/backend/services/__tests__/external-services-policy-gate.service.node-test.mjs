import assert from "node:assert/strict";
import test from "node:test";
import { ExternalServicesRegistry } from "../external-services.service.js";
import { AiAdditionsClient } from "../ai-additions-client.service.js";
import {
    dispatchCaseCreatedHook,
    resolveCaseAnalysisServiceIds,
} from "../../helpers/case-lifecycle-helper.js";
import { listServicesNotRunning } from "../../helpers/ai-service-launch-notice.js";

// The AI service policy gate (#815, epic #810). A production adapter receives
// events only when the policy version in force allows every AI Additions
// service it requires and a usable connection is stored: the session's pinned
// version for session hooks, the current one for case-created, listings and
// callbacks. Development adapters (the mocks) pass whenever they are
// registered. Callbacks for jobs that already exist are the one exception.

const JOB_UUID       = "c1d2e3f4-0000-4000-8000-000000000021";
const RESULT_UUID    = "c1d2e3f4-0000-4000-8000-000000000022";
const OTHER_JOB_UUID = "c1d2e3f4-0000-4000-8000-000000000023";
const UNKNOWN_UUID   = "c1d2e3f4-0000-4000-8000-000000000024";

// Version 1 is the seed (allows nothing), version 2 allows Polyadic Agents,
// version 3 is newer and removes it again.
const VERSIONS = new Map([
    [1, Object.freeze({ id: 1, allowedServiceIds: Object.freeze([]) })],
    [2, Object.freeze({ id: 2, allowedServiceIds: Object.freeze(["polyadic-agent"]) })],
    [3, Object.freeze({ id: 3, allowedServiceIds: Object.freeze([]) })],
]);

// Session id -> pinned version id.
const SESSION_PINS = new Map([[10, 2], [11, 1]]);

// Persisted jobs and the service each belongs to.
const JOBS = new Map([
    [JOB_UUID, "svc-production"],
    [OTHER_JOB_UUID, "svc-development"],
]);

// Like the real createResult(): the correlation id matches a job only when
// that job belongs to the calling service; the result is recorded either way.
async function createResultLikeTheJobsService({ correlationId, serviceId }) {
    const matches = Boolean(correlationId) && JOBS.get(correlationId) === serviceId;
    return {
        id:         RESULT_UUID,
        job_id:     matches ? correlationId : null,
        service_id: serviceId,
        status:     matches ? "callback_received" : "unknown_correlation",
    };
}

// A policy store over VERSIONS and SESSION_PINS that records its reads.
function makePolicy({ currentVersionId = 2, failWith = null } = {}) {
    const reads = [];
    const policy = {
        reads,
        currentVersionId,
        async getCurrentPolicyVersion() {
            reads.push("current");
            if (failWith) {
                throw failWith;
            }
            return VERSIONS.get(policy.currentVersionId);
        },
        async getPolicyVersion(id) {
            reads.push(`version:${id}`);
            return VERSIONS.get(Number(id)) ?? null;
        },
        async getSessionPolicyVersionId(sessionId) {
            reads.push(`session:${sessionId}`);
            if (failWith) {
                throw failWith;
            }
            return SESSION_PINS.get(Number(sessionId)) ?? null;
        },
    };
    return policy;
}

const HOOKS = ["phase-started", "student-response-submitted", "case-created", "callback-received"];
const SERVICE_IDS = ["svc-production", "svc-both", "svc-development"];

function makeRegistry({
    developmentAdapters = true,
    createResult = createResultLikeTheJobsService,
    policy = makePolicy(),
    connected = true,
    isAiAdditionsConfigured = async () => connected,
} = {}) {
    const createdJobs = [];
    const createdResults = [];
    const jobStatuses = [];
    const descriptorCalls = [];
    const registry = new ExternalServicesRegistry({
        developmentAdapters,
        aiServicePolicy: policy,
        isAiAdditionsConfigured,
        jobsService:     {
            createJob:       async args => { createdJobs.push(args); return { id: JOB_UUID }; },
            updateJobStatus: async (jobId, status) => { jobStatuses.push({ jobId, status }); },
            createResult:    async args => { createdResults.push(args); return createResult(args); },
            updateResult:    async () => {},
        },
        capabilityDescriptors: {
            getInstanceConfiguration: async (serviceId) => {
                descriptorCalls.push(serviceId);
                return { available: true, fields: [] };
            },
        },
    });
    registry.initialized = true;

    registry.services.set("svc-production", {
        id:           "svc-production",
        development:  false,
        requires:     ["polyadic-agent"],
        hooks:        HOOKS,
        globalHooks:  ["case-created"],
        scopes:       ["case", "chat"],
        descriptor:   { serviceId: "polyadic-agent", path: "/polyadic-agent/api/capabilities" },
        callbackAuth: null,
    });
    // Requires two services: allowed only when the version allows both.
    registry.services.set("svc-both", {
        id:           "svc-both",
        development:  false,
        requires:     ["polyadic-agent", "case-analyst"],
        hooks:        HOOKS,
        globalHooks:  [],
        scopes:       ["case"],
        callbackAuth: null,
    });
    if (developmentAdapters) {
        registry.services.set("svc-development", {
            id:           "svc-development",
            development:  true,
            requires:     [],
            hooks:        HOOKS,
            globalHooks:  ["case-created"],
            scopes:       ["case", "chat"],
            callbackAuth: null,
        });
    }

    // Each handler records that it ran (its side effect) and closes its job.
    const called = [];
    for (const hookName of HOOKS) {
        registry.hookSubscribers.set(hookName, SERVICE_IDS.map(serviceId => ({
            serviceId,
            handler: async (context, { callback }) => {
                called.push(`${serviceId}:${hookName}`);
                return callback({ status: "completed" });
            },
        })));
    }

    return { registry, policy, called, createdJobs, createdResults, jobStatuses, descriptorCalls };
}

function quietly(fn) {
    return async () => {
        const originalError = console.error;
        const originalWarn = console.warn;
        console.error = () => {};
        console.warn = () => {};
        try {
            await fn();
        } finally {
            console.error = originalError;
            console.warn = originalWarn;
        }
    };
}

// ─── the gate ────────────────────────────────────────────────────────────────

test("effectiveServiceIds: an adapter passes when the version allows all it requires", async () => {
    const { registry } = makeRegistry();
    const requested = ["svc-production", "svc-both", "svc-development", "unknown", "svc-production"];

    assert.deepEqual(await registry.effectiveServiceIds(requested, VERSIONS.get(2)),
        ["svc-production", "svc-development"]);
    assert.deepEqual(
        await registry.effectiveServiceIds(requested, {
            id: 4, allowedServiceIds: ["polyadic-agent", "case-analyst"],
        }),
        ["svc-production", "svc-both", "svc-development"]
    );
    assert.deepEqual(await registry.effectiveServiceIds(requested, VERSIONS.get(1)), ["svc-development"]);
    assert.deepEqual(await registry.effectiveServiceIds(requested, null), ["svc-development"]);
    assert.deepEqual(await registry.effectiveServiceIds(), []);
});

test("effectiveServiceIds: without a connection only development adapters pass", async () => {
    const { registry } = makeRegistry({ connected: false });

    assert.deepEqual(
        await registry.effectiveServiceIds(["svc-production", "svc-development"], VERSIONS.get(2)),
        ["svc-development"]
    );
});

test("effectiveServiceIds: a failed connection read counts as no connection", quietly(async () => {
    const { registry } = makeRegistry({
        isAiAdditionsConfigured: async () => { throw new Error("database unavailable"); },
    });

    assert.deepEqual(await registry.effectiveServiceIds(["svc-production"], VERSIONS.get(2)), []);
}));

test("development adapters pass whatever the policy and the connection", async () => {
    let connectionReads = 0;
    const { registry, policy, called } = makeRegistry({
        policy:                  makePolicy({ currentVersionId: 1 }),
        isAiAdditionsConfigured: async () => { connectionReads += 1; return false; },
    });

    assert.deepEqual(await registry.effectiveServiceIds(["svc-development"], null), ["svc-development"]);
    assert.equal(await registry.isServiceUsable("svc-development"), true);
    await registry.dispatchHook("phase-started", { sessionId: 11, phaseId: 2 }, {
        enabledServiceIds: ["svc-development"],
    });

    assert.deepEqual(called, ["svc-development:phase-started"]);
    assert.deepEqual(policy.reads, [], "no policy read when only development adapters are requested");
    assert.equal(connectionReads, 0, "no connection read either");
});

test("development adapters are not usable when they are not registered", async () => {
    const { registry } = makeRegistry({ developmentAdapters: false });

    assert.equal(await registry.isServiceUsable("svc-development"), false);
    assert.deepEqual(await registry.listUsableServices().then(list => list.map(({ id }) => id)),
        ["svc-production"]);
});

// ─── session hooks follow the session's pinned version ───────────────────────

test("session hooks: a session pinned to an allowing version keeps the service after a newer version removes it", async () => {
    const { registry, policy, called } = makeRegistry({ policy: makePolicy({ currentVersionId: 3 }) });

    for (const hookName of ["phase-started", "student-response-submitted"]) {
        await registry.dispatchHook(hookName, { sessionId: 10, phaseId: 2 }, {
            enabledServiceIds: ["svc-production"],
        });
    }

    assert.deepEqual(called, [
        "svc-production:phase-started",
        "svc-production:student-response-submitted",
    ]);
    assert.equal(policy.reads.includes("current"), false, "the current version is not consulted");
    assert.ok(policy.reads.includes("session:10"));
    assert.ok(policy.reads.includes("version:2"));
});

test("session hooks: a session pinned to version 1 gets nothing, even when the current version allows it", async () => {
    const { registry, called, createdJobs } = makeRegistry({ policy: makePolicy({ currentVersionId: 2 }) });

    const results = await registry.dispatchHook("phase-started", { sessionId: 11, phaseId: 2 }, {
        enabledServiceIds: ["svc-production"],
    });

    assert.deepEqual(results, []);
    assert.deepEqual(called, []);
    assert.deepEqual(createdJobs, [], "no job is created");
});

test("session hooks: a new session follows the version current at its launch", async () => {
    const policy = makePolicy({ currentVersionId: 2 });
    const { registry, called } = makeRegistry({ policy });

    // A session launched under version 3 (which removed the service).
    SESSION_PINS.set(12, 3);
    try {
        await registry.dispatchHook("phase-started", { sessionId: 12, phaseId: 2 }, {
            enabledServiceIds: ["svc-production", "svc-development"],
        });
    } finally {
        SESSION_PINS.delete(12);
    }

    assert.deepEqual(called, ["svc-development:phase-started"]);
});

test("session hooks: without a connection nothing is dispatched to AI Additions adapters", async () => {
    const { registry, called, createdJobs } = makeRegistry({ connected: false });

    const results = await registry.dispatchHook("phase-started", { sessionId: 10, phaseId: 2 }, {
        enabledServiceIds: ["svc-production"],
    });

    assert.deepEqual(results, []);
    assert.deepEqual(called, []);
    assert.deepEqual(createdJobs, []);
});

test("session hooks: a hook without sessionId follows no version", quietly(async () => {
    const { registry, called } = makeRegistry();

    await registry.dispatchHook("phase-started", { phaseId: 2 }, {
        enabledServiceIds: ["svc-production", "svc-development"],
    });

    assert.deepEqual(called, ["svc-development:phase-started"]);
}));

test("session hooks: a failed policy read dispatches nothing to AI Additions adapters", quietly(async () => {
    const { registry, called } = makeRegistry({
        policy: makePolicy({ failWith: new Error("database unavailable") }),
    });

    await registry.dispatchHook("phase-started", { sessionId: 10, phaseId: 2 }, {
        enabledServiceIds: ["svc-production", "svc-development"],
    });

    assert.deepEqual(called, ["svc-development:phase-started"]);
}));

// ─── case-created follows the current version ────────────────────────────────

test("case-created: follows the current version", async () => {
    const allowing = makeRegistry({ policy: makePolicy({ currentVersionId: 2 }) });
    await allowing.registry.dispatchHook("case-created", { caseId: 3 }, {
        enabledServiceIds: ["svc-production"],
    });
    assert.deepEqual(allowing.called, ["svc-production:case-created"]);
    assert.ok(allowing.policy.reads.includes("current"));

    const removing = makeRegistry({ policy: makePolicy({ currentVersionId: 3 }) });
    await removing.registry.dispatchHook("case-created", { caseId: 3 }, {
        enabledServiceIds: ["svc-production"],
    });
    assert.deepEqual(removing.called, []);
});

test("case-created: dispatchGlobalHook applies the gate under the current version", async () => {
    const { registry, called } = makeRegistry({ policy: makePolicy({ currentVersionId: 1 }) });

    await registry.dispatchGlobalHook("case-created", { caseId: 3 });

    assert.deepEqual(called, ["svc-development:case-created"]);
});

test("case-created: the version bounds the author's choice and never replaces it", async () => {
    const { registry, called } = makeRegistry({ policy: makePolicy({ currentVersionId: 2 }) });
    const released = [];

    // The author chose only svc-both, which version 2 does not allow (it also
    // requires case-analyst); svc-production is allowed but was not chosen.
    await dispatchCaseCreatedHook({ caseId: 3 }, {
        registry,
        reservations:       [{ case_id: 3, service_id: "svc-both", job_id: JOB_UUID }],
        releaseReservation: async reservation => { released.push(reservation.serviceId); },
    });

    assert.deepEqual(called, []);
    assert.deepEqual(released, ["svc-both"], "the unstarted reservation is released");
});

test("case creation: the author may only choose case services the current version allows", async () => {
    const current2 = makeRegistry({ policy: makePolicy({ currentVersionId: 2 }) }).registry;
    const current3 = makeRegistry({ policy: makePolicy({ currentVersionId: 3 }) }).registry;

    assert.deepEqual(
        await resolveCaseAnalysisServiceIds(["svc-production"], { registry: current2 }),
        { serviceIds: ["svc-production"], valid: true }
    );
    assert.equal(
        (await resolveCaseAnalysisServiceIds(["svc-production"], { registry: current3 })).valid,
        false
    );
    assert.equal(
        (await resolveCaseAnalysisServiceIds(["svc-both"], { registry: current2 })).valid,
        false
    );
});

// ─── listings ────────────────────────────────────────────────────────────────

test("listings: only the adapters the current version allows, with a connection", async () => {
    const allowing = makeRegistry({ policy: makePolicy({ currentVersionId: 2 }) });
    assert.deepEqual((await allowing.registry.listUsableServices()).map(({ id }) => id),
        ["svc-production", "svc-development"]);
    assert.deepEqual(await allowing.registry.getUsableServiceIdsForScope("case"),
        ["svc-production", "svc-development"]);

    const removing = makeRegistry({ policy: makePolicy({ currentVersionId: 3 }) });
    assert.deepEqual((await removing.registry.listUsableServices()).map(({ id }) => id),
        ["svc-development"]);
    assert.deepEqual(await removing.registry.getUsableServiceIdsForGlobalHook("case-created"),
        ["svc-development"]);

    const disconnected = makeRegistry({ connected: false });
    assert.deepEqual((await disconnected.registry.listUsableServices()).map(({ id }) => id),
        ["svc-development"]);
});

test("listings: a given version is used as is, without reading the current one", async () => {
    const { registry, policy } = makeRegistry({ policy: makePolicy({ currentVersionId: 3 }) });

    const listed = await registry.listUsableServices({ policyVersion: VERSIONS.get(2) });

    assert.deepEqual(listed.map(({ id }) => id), ["svc-production", "svc-development"]);
    assert.deepEqual(policy.reads, []);
});

test("listings: the catalog keeps every registered adapter, usable or not", () => {
    const { registry } = makeRegistry({ policy: makePolicy({ currentVersionId: 1 }) });

    assert.deepEqual(
        registry.listServices().map(({ id, development, requires }) => ({ id, development, requires })),
        [
            { id: "svc-production", development: false, requires: ["polyadic-agent"] },
            { id: "svc-both", development: false, requires: ["polyadic-agent", "case-analyst"] },
            { id: "svc-development", development: true, requires: [] },
        ]
    );
});

test("instance configuration: only for services the current version allows", async () => {
    const removing = makeRegistry({ policy: makePolicy({ currentVersionId: 3 }) });
    assert.equal(await removing.registry.getServiceInstanceConfiguration("svc-production", "en_US"), null);
    assert.deepEqual(removing.descriptorCalls, []);

    const allowing = makeRegistry({ policy: makePolicy({ currentVersionId: 2 }) });
    assert.deepEqual(
        await allowing.registry.getServiceInstanceConfiguration("svc-production", "en_US"),
        { available: true, fields: [] }
    );
    assert.deepEqual(allowing.descriptorCalls, ["svc-production"]);
});

// ─── launch notice ───────────────────────────────────────────────────────────

test("launch notice: lists the enabled services the pinned version does not run", async () => {
    const { registry } = makeRegistry({ policy: makePolicy({ currentVersionId: 3 }) });
    const design = {
        phases: [
            { externalServices: { enabledServiceIds: ["svc-production", "svc-both"] } },
            { externalServices: { enabledServiceIds: ["svc-development", "unknown-service"] } },
        ],
    };

    const pinnedTo2 = await listServicesNotRunning({ design, policyVersionId: 2 }, { registry });
    assert.deepEqual(pinnedTo2, [
        { id: "svc-both", ui: { translations: null } },
        { id: "unknown-service", ui: { translations: null } },
    ]);

    const pinnedTo1 = await listServicesNotRunning({
        design:          JSON.stringify(design),
        policyVersionId: 1,
    }, { registry });
    assert.deepEqual(pinnedTo1.map(({ id }) => id), ["svc-production", "svc-both", "unknown-service"]);

    assert.deepEqual(await listServicesNotRunning({ design: { phases: [] }, policyVersionId: 2 }, {
        registry,
    }), []);
});

// ─── stored URLs that are not valid count as no connection ───────────────────

const INVALID_CONNECTIONS = {
    "a base_url with a query":            { baseUrl: "https://ai.example.org?x=1" },
    "a base_url with a fragment":         { baseUrl: "https://ai.example.org/#frag" },
    "a base_url with userinfo":           { baseUrl: "https://user:pass@ai.example.org" },
    "a base_url without an authority":    { baseUrl: "https:///ai-additions" },
    "a keycloak_public_url with a query": {
        baseUrl: "https://ai.example.org", keycloakPublicUrl: "https://auth.example.org/keycloak?a=b",
    },
    "a keycloak_public_url with userinfo": {
        baseUrl: "https://ai.example.org", keycloakPublicUrl: "https://@auth.example.org/keycloak",
    },
};

for (const [label, connection] of Object.entries(INVALID_CONNECTIONS)) {
    test(`stored connection with ${label}: nothing dispatched and not_configured`, async () => {
        const fetchCalls = [];
        const client = new AiAdditionsClient({
            env:             {},
            getConnection:   async () => connection,
            connectionTtlMs: 0,
            fetchImpl:       async (url) => { fetchCalls.push(url); throw new Error("no network"); },
        });
        const { registry, called } = makeRegistry({
            isAiAdditionsConfigured: () => client.isConfigured(),
        });

        await registry.dispatchHook("phase-started", { sessionId: 10, phaseId: 2 }, {
            enabledServiceIds: ["svc-production"],
        });

        assert.deepEqual(called, []);
        await assert.rejects(client.requestJson("/anything"), { code: "not_configured" });
        assert.deepEqual(fetchCalls, []);
    });
}

test("stored connection with valid URLs and a path prefix: the gate lets the service through", async () => {
    const client = new AiAdditionsClient({
        env:           {},
        getConnection: async () => ({
            baseUrl:           "https://ai.example.org/ai-additions/",
            keycloakPublicUrl: "https://ai.example.org/keycloak",
        }),
        connectionTtlMs: 0,
        fetchImpl:       async () => { throw new Error("no network"); },
    });
    const { registry, called } = makeRegistry({ isAiAdditionsConfigured: () => client.isConfigured() });

    await registry.dispatchHook("phase-started", { sessionId: 10, phaseId: 2 }, {
        enabledServiceIds: ["svc-production"],
    });

    assert.deepEqual(called, ["svc-production:phase-started"]);
});

// ─── callbacks ───────────────────────────────────────────────────────────────

test("callbacks: an existing job of a service the current version removed still completes", async () => {
    const { registry, called, createdResults, jobStatuses } = makeRegistry({
        policy: makePolicy({ currentVersionId: 3 }),
    });

    assert.doesNotThrow(() => registry.authorizeCallbackCaller("svc-production", { clientId: "x" }));
    const { resultRecord, outcomes } = await registry.dispatchServiceHook(
        "callback-received",
        "svc-production",
        { correlationId: JOB_UUID }
    );

    assert.equal(resultRecord.job_id, JOB_UUID);
    assert.deepEqual(outcomes.map(outcome => outcome.status), ["fulfilled"]);
    assert.deepEqual(called, ["svc-production:callback-received"]);
    assert.equal(createdResults[0].serviceId, "svc-production");
    assert.deepEqual(jobStatuses.map(({ jobId, status }) => ({ jobId, status })), [
        { jobId: JOB_UUID, status: "completed" },
    ]);
});

// A service that is not usable must not act on a callback that matches none
// of its jobs: its handler never runs, though the result is still recorded.
const UNMATCHED_CALLBACKS = {
    "no correlation id":                {},
    "an unknown correlation id":        { correlationId: UNKNOWN_UUID },
    "another service's correlation id": { correlationId: OTHER_JOB_UUID },
};

for (const [label, context] of Object.entries(UNMATCHED_CALLBACKS)) {
    test(`callbacks: 409 and no handler for a service not allowed now with ${label}`, async () => {
        const { registry, called, createdResults, jobStatuses } = makeRegistry({
            policy: makePolicy({ currentVersionId: 3 }),
        });

        await assert.rejects(
            () => registry.dispatchServiceHook("callback-received", "svc-production", context),
            { statusCode: 409 }
        );

        assert.deepEqual(called, []);
        assert.deepEqual(jobStatuses, []);
        assert.equal(createdResults.length, 1, "the callback is still recorded");
    });
}

test("callbacks: 409 when the matched job belongs to another service", async () => {
    const { registry, called } = makeRegistry({
        policy:       makePolicy({ currentVersionId: 3 }),
        createResult: async () => ({ id: RESULT_UUID, job_id: OTHER_JOB_UUID, service_id: "svc-development" }),
    });

    await assert.rejects(
        () => registry.dispatchServiceHook("callback-received", "svc-production", {
            correlationId: OTHER_JOB_UUID,
        }),
        { statusCode: 409 }
    );
    assert.deepEqual(called, []);
});

test("callbacks: 503 and no handler for a service not allowed now when the lookup fails", async () => {
    for (const createResult of [
        async () => { throw new Error("database unavailable"); },
        async () => null,
    ]) {
        const { registry, called, jobStatuses } = makeRegistry({
            policy: makePolicy({ currentVersionId: 3 }),
            createResult,
        });

        await assert.rejects(
            () => registry.dispatchServiceHook("callback-received", "svc-production", {
                correlationId: JOB_UUID,
            }),
            { statusCode: 503 }
        );
        assert.deepEqual(called, []);
        assert.deepEqual(jobStatuses, []);
    }
});

// Usable services keep the behavior they had before #812: their callbacks
// are delivered with or without a matching job.
test("callbacks: a usable service still receives callbacks without a matching job", async () => {
    for (const serviceId of ["svc-production", "svc-development"]) {
        const { registry, called } = makeRegistry({ policy: makePolicy({ currentVersionId: 2 }) });

        const { outcomes } = await registry.dispatchServiceHook("callback-received", serviceId, {});

        assert.equal(outcomes.length, 1);
        assert.deepEqual(called, [`${serviceId}:callback-received`]);
    }
});

test("callbacks: 404 for an adapter that is not registered", async () => {
    const { registry } = makeRegistry();

    assert.throws(() => registry.authorizeCallbackCaller("unknown", {}), { statusCode: 404 });
    await assert.rejects(() => registry.dispatchServiceHook("callback-received", "unknown", {}), {
        statusCode: 404,
    });
});

test("registerService: a development adapter is skipped, and not imported, without the variable", async () => {
    const imported = [];
    const originalInfo = console.info;
    console.info = () => {};

    try {
        for (const developmentAdapters of [false, true]) {
            const registry = new ExternalServicesRegistry({
                jobsService:   {},
                developmentAdapters,
                importAdapter: async href => { imported.push(href); return { register: async () => {} }; },
            });

            await registry.registerService({
                id:          "svc-mock",
                adapter:     "./adapters/mock.adapter.js",
                development: true,
                requires:    [],
                scopes:      ["chat"],
            }, "/catalog/manifest.json");

            assert.equal(registry.services.has("svc-mock"), developmentAdapters, String(developmentAdapters));
        }
    } finally {
        console.info = originalInfo;
    }

    assert.deepEqual(imported, ["file:///catalog/adapters/mock.adapter.js"]);
});

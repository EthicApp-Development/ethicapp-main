import assert from "node:assert/strict";
import test from "node:test";
import {
    assertCallbackTargetWithinJob,
    ExternalServicesRegistry,
} from "../external-services.service.js";
import { getCallbackTarget } from "../../external-services/adapters/polyadic-bridge.adapter.js";
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
// The svc-production job was dispatched for session 10 (pinned to version 2),
// phase 2, question 4, group 3, user 5.
const JOBS = new Map([
    [JOB_UUID, {
        serviceId: "svc-production", sessionId: 10, phaseId: 2, questionId: 4, groupId: 3, userId: 5,
    }],
    [OTHER_JOB_UUID, {
        serviceId: "svc-development", sessionId: 10, phaseId: 2, questionId: null, groupId: 3, userId: null,
    }],
]);

// Like the real createResult(): the correlation id matches a job only when
// that job belongs to the calling service, and the match carries the job's
// context; the result is recorded either way.
async function createResultLikeTheJobsService({ correlationId, serviceId }) {
    const stored = correlationId ? JOBS.get(correlationId) : null;
    const matches = Boolean(stored) && stored.serviceId === serviceId;
    const context = { ...stored };
    delete context.serviceId;
    return {
        id:         RESULT_UUID,
        job_id:     matches ? correlationId : null,
        service_id: serviceId,
        status:     matches ? "callback_received" : "unknown_correlation",
        ...(matches ? { job: { id: correlationId, ...context } } : {}),
        ...(stored && !matches ? { correlates_other_service: true } : {}),
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

// Sessions 10 (pinned to version 2) and 11 (pinned to version 1) are both
// launched and in progress on their phase 2, which has group 3 and in which
// user 5 takes part. Phase 2's design enables svc-production and
// svc-development.
function makeDestinationLookups({
    state = {},
    enabledServiceIds = ["svc-production", "svc-development"],
    failPhaseState = false,
    failDesign = false,
} = {}) {
    const reads = [];
    return {
        reads,
        async loadPhaseState({ sessionId, phaseId, groupId, userId }) {
            reads.push(["state", sessionId, phaseId]);
            if (failPhaseState) {
                throw new Error("database unavailable");
            }
            if (![10, 11].includes(sessionId) || phaseId !== 2) {
                return null;
            }
            return {
                current_stage:     2,
                status:            2,
                launched:          true,
                group_exists:      groupId === 3,
                user_participates: userId === 5,
                ...state,
            };
        },
        async loadPhaseExternalServices(phaseId) {
            reads.push(["design", phaseId]);
            if (failDesign) {
                throw new Error("database unavailable");
            }
            return { enabledServiceIds, configurations: {} };
        },
    };
}

function makeRegistry({
    developmentAdapters = true,
    createResult = createResultLikeTheJobsService,
    policy = makePolicy(),
    connected = true,
    isAiAdditionsConfigured = async () => connected,
    callbackDestinationLookups = makeDestinationLookups(),
} = {}) {
    const createdJobs = [];
    const createdResults = [];
    const jobStatuses = [];
    const descriptorCalls = [];
    const registry = new ExternalServicesRegistry({
        developmentAdapters,
        aiServicePolicy: policy,
        isAiAdditionsConfigured,
        callbackDestinationLookups,
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
//
// Every callback needs a persisted job of its service, whatever the current
// policy allows, and its payload may only target that job's destination.

// A Polyadic-like callback handler: it publishes into the group its payload's
// room names, and the registry checks that room against the job.
function withPublishingHandler(registry) {
    const published = [];
    registry.callbackTargetResolvers.set("svc-production", getCallbackTarget);
    registry.hookSubscribers.set("callback-received", [{
        serviceId: "svc-production",
        handler:   async (context, { callback }) => {
            published.push({ room: context.requestPayload?.room, job: context.job });
            return callback({ status: "completed" });
        },
    }]);
    return published;
}

// ─── callbacks without a job (proactive interventions, option A) ─────────────

const FRESH_UUID = "c1d2e3f4-0000-4000-8000-0000000000ff";

function proactive(room = "ethicapp-s10-p2-g3") {
    return { correlationId: FRESH_UUID, requestPayload: { room, evaluations: [{}] } };
}

test("callbacks: a proactive callback into an allowed, active destination is delivered", async () => {
    const { registry, policy } = makeRegistry({ policy: makePolicy({ currentVersionId: 2 }) });
    const published = withPublishingHandler(registry);
    let seen = null;
    const handler = registry.hookSubscribers.get("callback-received")[0].handler;
    registry.hookSubscribers.get("callback-received")[0].handler = async (context, tools) => {
        seen = context;
        return handler(context, tools);
    };

    const { outcomes } = await registry.dispatchServiceHook(
        "callback-received", "svc-production", { ...proactive(), sessionId: 99 }
    );

    assert.deepEqual(outcomes.map(outcome => outcome.status), ["fulfilled"]);
    assert.deepEqual(published.map(({ room }) => room), ["ethicapp-s10-p2-g3"]);
    assert.deepEqual(
        { sessionId: seen.sessionId, phaseId: seen.phaseId, groupId: seen.groupId, job: seen.job },
        { sessionId: 10, phaseId: 2, groupId: 3, job: null },
        "the verified destination, not the request's"
    );
    assert.ok(policy.reads.includes("session:10"));
    assert.equal(policy.reads.includes("current"), false, "never the current version");
});

test("callbacks: a running activity keeps its policy for proactive callbacks after the current version removes the service", async () => {
    const { registry } = makeRegistry({ policy: makePolicy({ currentVersionId: 3 }) });
    const published = withPublishingHandler(registry);

    await registry.dispatchServiceHook("callback-received", "svc-production", proactive());

    assert.deepEqual(published.map(({ room }) => room), ["ethicapp-s10-p2-g3"]);
});

test("callbacks: a session pinned to version 1 gets nothing without a job, even when the current version allows the service", async () => {
    for (const correlationId of [undefined, UNKNOWN_UUID]) {
        const { registry, createdResults } = makeRegistry({ policy: makePolicy({ currentVersionId: 2 }) });
        const published = withPublishingHandler(registry);

        await assert.rejects(
            () => registry.dispatchServiceHook("callback-received", "svc-production", {
                correlationId,
                requestPayload: { room: "ethicapp-s11-p2-g3", evaluations: [{}] },
            }),
            { statusCode: 409 }
        );
        assert.deepEqual(published, [], String(correlationId));
        assert.equal(createdResults.length, 1, "the callback is still recorded");
    }
});

const REFUSED_DESTINATIONS = {
    "an ended phase (activity no longer in progress)": {
        lookups: makeDestinationLookups({ state: { status: 3 } }),
    },
    "a phase that is not the session's current one": {
        lookups: makeDestinationLookups({ state: { current_stage: 7 } }),
    },
    "a session that was not launched": {
        lookups: makeDestinationLookups({ state: { launched: false } }),
    },
    "a phase outside the session":                      { room: "ethicapp-s10-p9-g3" },
    "a phase whose design does not enable the adapter": {
        lookups: makeDestinationLookups({ enabledServiceIds: ["svc-development"] }),
    },
    "a group that does not exist in the phase": { room: "ethicapp-s10-p2-g8" },
    "a payload that names no destination":      { room: "not-a-room" },
    "a session with no pinned version":         { room: "ethicapp-s77-p2-g3" },
};

for (const [label, { lookups, room }] of Object.entries(REFUSED_DESTINATIONS)) {
    test(`callbacks: a proactive callback into ${label} is rejected (409)`, async () => {
        const updatedResults = [];
        const { registry } = makeRegistry({
            ...(lookups ? { callbackDestinationLookups: lookups } : {}),
        });
        registry._jobsService.updateResult = async (id, update) => { updatedResults.push(update.status); };
        const published = withPublishingHandler(registry);

        await assert.rejects(
            () => registry.dispatchServiceHook("callback-received", "svc-production", proactive(room)),
            { statusCode: 409 }
        );
        assert.deepEqual(published, []);
        assert.deepEqual(updatedResults, ["failed"]);
    });
}

test("callbacks: an adapter without getCallbackTarget gets no callback without a job", async () => {
    const { registry, called } = makeRegistry();
    registry.callbackTargetResolvers.delete("svc-production");

    await assert.rejects(
        () => registry.dispatchServiceHook("callback-received", "svc-production", proactive()),
        { statusCode: 409 }
    );
    assert.deepEqual(called, []);
});

const FAILED_LOOKUPS = {
    "the pinned version": {
        policy: makePolicy({ failWith: new Error("database unavailable") }),
    },
    "the connection": {
        isAiAdditionsConfigured: async () => { throw new Error("database unavailable"); },
    },
    "the phase state": {
        callbackDestinationLookups: makeDestinationLookups({ failPhaseState: true }),
    },
    "the phase design": {
        callbackDestinationLookups: makeDestinationLookups({ failDesign: true }),
    },
};

for (const [label, options] of Object.entries(FAILED_LOOKUPS)) {
    test(`callbacks: a failed lookup of ${label} publishes nothing (503)`, quietly(async () => {
        const { registry } = makeRegistry(options);
        const published = withPublishingHandler(registry);

        await assert.rejects(
            () => registry.dispatchServiceHook("callback-received", "svc-production", proactive()),
            { statusCode: 503 }
        );
        assert.deepEqual(published, []);
    }));
}

test("callbacks: without a connection a proactive callback is refused as not_configured", async () => {
    const { registry } = makeRegistry({ connected: false });
    const published = withPublishingHandler(registry);

    await assert.rejects(
        () => registry.dispatchServiceHook("callback-received", "svc-production", proactive()),
        { statusCode: 503, code: "not_configured" }
    );
    assert.deepEqual(published, []);
});

// ─── callbacks that match a job ──────────────────────────────────────────────

test("callbacks: a correlation id of another service's job is rejected", async () => {
    const { registry } = makeRegistry();
    const published = withPublishingHandler(registry);

    await assert.rejects(
        () => registry.dispatchServiceHook("callback-received", "svc-production", {
            correlationId:  OTHER_JOB_UUID,
            requestPayload: { room: "ethicapp-s10-p2-g3" },
        }),
        { statusCode: 409 }
    );
    assert.deepEqual(published, []);
});

const OTHER_TARGETS = {
    "another session": "ethicapp-s11-p2-g3",
    "another phase":   "ethicapp-s10-p9-g3",
    "another group":   "ethicapp-s10-p2-g8",
};

for (const [label, room] of Object.entries(OTHER_TARGETS)) {
    test(`callbacks: a valid job whose payload targets ${label} is rejected before publishing`, async () => {
        const updatedResults = [];
        const { registry } = makeRegistry();
        registry._jobsService.updateResult = async (id, update) => { updatedResults.push(update.status); };
        const published = withPublishingHandler(registry);

        await assert.rejects(
            () => registry.dispatchServiceHook("callback-received", "svc-production", {
                correlationId:  JOB_UUID,
                requestPayload: { room },
            }),
            { statusCode: 409 }
        );
        assert.deepEqual(published, []);
        assert.deepEqual(updatedResults, ["failed"]);
    });
}

test("callbacks: a payload naming a target its job lacks is rejected", () => {
    assert.throws(
        () => assertCallbackTargetWithinJob({ sessionId: 10, phaseId: 2, groupId: null }, {
            sessionId: 10, phaseId: 2, groupId: 3,
        }, "svc"),
        { statusCode: 409 }
    );
    assert.doesNotThrow(() => assertCallbackTargetWithinJob(
        { sessionId: 10, phaseId: 2, groupId: 3 },
        { sessionId: "10", phaseId: 2, groupId: undefined, userId: null },
        "svc"
    ));
    assert.doesNotThrow(() => assertCallbackTargetWithinJob({ sessionId: 10 }, null, "svc"));
});

test("callbacks: the handler gets the job's destination, not the request's", async () => {
    const { registry } = makeRegistry();
    let seen = null;
    registry.hookSubscribers.set("callback-received", [{
        serviceId: "svc-production",
        handler:   async context => { seen = context; },
    }]);

    await registry.dispatchServiceHook("callback-received", "svc-production", {
        correlationId: JOB_UUID,
        sessionId:     99,
        groupId:       99,
    });

    assert.deepEqual(
        { sessionId:  seen.sessionId, phaseId:    seen.phaseId, questionId: seen.questionId,
            groupId:    seen.groupId, userId:     seen.userId },
        { sessionId: 10, phaseId: 2, questionId: 4, groupId: 3, userId: 5 }
    );
    assert.equal(seen.job.id, JOB_UUID);
});

test("callbacks: a genuine job still completes after the current version removes its service", async () => {
    const { registry, createdResults, jobStatuses } = makeRegistry({
        policy: makePolicy({ currentVersionId: 3 }),
    });
    const published = withPublishingHandler(registry);

    assert.doesNotThrow(() => registry.authorizeCallbackCaller("svc-production", { clientId: "x" }));
    const { resultRecord, outcomes } = await registry.dispatchServiceHook(
        "callback-received",
        "svc-production",
        { correlationId: JOB_UUID, requestPayload: { room: "ethicapp-s10-p2-g3" } }
    );

    assert.equal(resultRecord.job_id, JOB_UUID);
    assert.deepEqual(outcomes.map(outcome => outcome.status), ["fulfilled"]);
    assert.deepEqual(published.map(({ room, job }) => ({ room, sessionId: job.sessionId })), [
        { room: "ethicapp-s10-p2-g3", sessionId: 10 },
    ]);
    assert.equal(createdResults[0].serviceId, "svc-production");
    assert.deepEqual(jobStatuses.map(({ jobId, status }) => ({ jobId, status })), [
        { jobId: JOB_UUID, status: "completed" },
    ]);
});

test("callbacks: a failed job lookup publishes nothing (503)", async () => {
    for (const createResult of [
        async () => { throw new Error("database unavailable"); },
        async () => null,
    ]) {
        const { registry, jobStatuses } = makeRegistry({ createResult });
        const published = withPublishingHandler(registry);

        await assert.rejects(
            () => registry.dispatchServiceHook("callback-received", "svc-production", {
                correlationId:  JOB_UUID,
                requestPayload: { room: "ethicapp-s10-p2-g3" },
            }),
            { statusCode: 503 }
        );
        assert.deepEqual(published, []);
        assert.deepEqual(jobStatuses, []);
    }
});

// Development adapters follow the same rules. The mocks never receive HTTP
// callbacks, so this costs them nothing.
test("callbacks: development adapters follow the same rules", async () => {
    const without = makeRegistry();
    await assert.rejects(
        () => without.registry.dispatchServiceHook("callback-received", "svc-development", {}),
        { statusCode: 409 }
    );
    assert.deepEqual(without.called, []);

    const withJob = makeRegistry();
    const { outcomes } = await withJob.registry.dispatchServiceHook(
        "callback-received", "svc-development", { correlationId: OTHER_JOB_UUID }
    );
    assert.equal(outcomes.length, 1);
    assert.deepEqual(withJob.called, ["svc-development:callback-received"]);

    // With a target, a development adapter is checked like any other, but it
    // needs no connection, as for dispatch.
    const proactiveMock = makeRegistry({ connected: false });
    proactiveMock.registry.callbackTargetResolvers.set("svc-development", getCallbackTarget);
    await proactiveMock.registry.dispatchServiceHook("callback-received", "svc-development", proactive());
    assert.deepEqual(proactiveMock.called, ["svc-development:callback-received"]);
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

test("adapters name their callback target from the payload", async () => {
    const ats = await import("../../external-services/adapters/ats-feedback.adapter.js");
    const mock = await import("../../external-services/adapters/mock-ai-response-review.adapter.js");

    assert.deepEqual(getCallbackTarget({ room: "ethicapp-s1-p2-g3" }), {
        sessionId: 1, phaseId: 2, groupId: 3,
    });
    assert.deepEqual(getCallbackTarget({ room: "elsewhere" }), {});
    assert.deepEqual(
        ats.getCallbackTarget({ sessionId: "1", phaseId: 2, questionId: 3, userId: 4, groupId: 9 }),
        { sessionId: 1, phaseId: 2, questionId: 3, userId: 4 }
    );
    assert.deepEqual(ats.getCallbackTarget({}), {
        sessionId: null, phaseId: null, questionId: null, userId: null,
    });
    assert.deepEqual(mock.getCallbackTarget({ userId: 4 }), {
        sessionId: null, phaseId: null, questionId: null, userId: 4,
    });
});

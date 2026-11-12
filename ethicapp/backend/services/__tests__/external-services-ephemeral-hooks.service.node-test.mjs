// Ephemeral hooks (epic #601, #654): `participant-activity` reaches only the
// subscribed services among the requested ones that the AI service policy
// gate allows, and creates no job, injects no job id, passes no callback and
// collects no result. A failing handler affects neither the others nor the
// caller.
import assert from "node:assert/strict";
import test from "node:test";

import {
    COLLECTING_HOOKS,
    EPHEMERAL_HOOKS,
    ExternalServicesRegistry,
} from "../external-services.service.js";
import {
    normalizeParticipantActivityContext,
    PARTICIPANT_ACTIVITY_HOOK,
} from "../external-service-ephemeral-hooks.js";
import { captureWarnings } from "./capture-warnings.mjs";

const HOOK = PARTICIPANT_ACTIVITY_HOOK;
const RECEIVED_AT = "2026-11-12T15:04:05.000Z";

// Session 10 is pinned to a version that allows Polyadic Agents only.
const ALLOWED_VERSION = Object.freeze({ id: 2, allowedServiceIds: Object.freeze(["polyadic-agent"]) });

const CONTEXT = Object.freeze({
    kind:       "composing",
    sessionId:  10,
    phaseId:    20,
    questionId: 30,
    groupId:    40,
    userId:     50,
    receivedAt: RECEIVED_AT,
    ttlSeconds: 30,
});

// Every jobs-service call is recorded, so a test can tell that none was made.
function makeJobsServiceFake() {
    const calls = [];
    const jobsService = new Proxy({}, {
        get: (target, name) => async (...args) => {
            calls.push({ name, args });
            return { id: "job-should-not-exist" };
        },
    });
    return { jobsService, calls };
}

// svc-polyadic: production, allowed by the session's version.
// svc-analyst: production, requires a service the version does not allow.
// svc-mock: development, allowed whenever registered.
// svc-elsewhere: allowed and subscribed, but never requested by the tests.
// svc-silent: requested and declares the hook, but has no handler.
function makeRegistry({ connected = true, failPolicy = false, handlers = {} } = {}) {
    const policyReads = [];
    const { jobsService, calls: jobsCalls } = makeJobsServiceFake();
    const registry = new ExternalServicesRegistry({
        jobsService,
        developmentAdapters:     true,
        isAiAdditionsConfigured: async () => connected,
        aiServicePolicy:         {
            async getCurrentPolicyVersion() {
                policyReads.push("current");
                return ALLOWED_VERSION;
            },
            async getPolicyVersion(id) {
                policyReads.push(`version:${id}`);
                return Number(id) === ALLOWED_VERSION.id ? ALLOWED_VERSION : null;
            },
            async getSessionPolicyVersionId(sessionId) {
                policyReads.push(`session:${sessionId}`);
                if (failPolicy) {
                    throw new Error("database unavailable");
                }
                return sessionId === 10 ? ALLOWED_VERSION.id : null;
            },
        },
        roomJobsService: new Proxy({}, {
            get: (target, name) => async () => { throw new Error(`roomJobs.${String(name)} must not be called`); },
        }),
    });
    registry.initialized = true;

    for (const [id, development, requires] of [
        ["svc-polyadic", false, ["polyadic-agent"]],
        ["svc-analyst", false, ["case-analyst"]],
        ["svc-mock", true, []],
        ["svc-elsewhere", false, ["polyadic-agent"]],
        ["svc-silent", false, ["polyadic-agent"]],
    ]) {
        registry.services.set(id, {
            id, development, requires, hooks: [HOOK, "chat-message-received"], globalHooks: [], scopes: ["chat"],
        });
    }

    const calls = [];
    for (const serviceId of ["svc-polyadic", "svc-analyst", "svc-mock", "svc-elsewhere"]) {
        registry.subscribe(serviceId, HOOK, handlers[serviceId] ?? (async (...args) => {
            calls.push({ serviceId, args });
            return { status: "completed", stored: "never collected" };
        }));
    }

    return { registry, calls, jobsCalls, policyReads };
}

const REQUESTED = ["svc-polyadic", "svc-analyst", "svc-mock", "svc-silent", "unknown"];

test("participant-activity is the one ephemeral hook, apart from the collecting ones", () => {
    assert.deepEqual(EPHEMERAL_HOOKS, ["participant-activity"]);
    assert.ok(Object.isFrozen(EPHEMERAL_HOOKS));
    assert.equal(EPHEMERAL_HOOKS.some(hookName => COLLECTING_HOOKS.includes(hookName)), false);
});

test("dispatchEphemeralHook calls only subscribed, requested services the policy allows", async () => {
    const { registry, calls, policyReads } = makeRegistry();

    const outcomes = await registry.dispatchEphemeralHook(HOOK, CONTEXT, { enabledServiceIds: REQUESTED });

    assert.deepEqual(calls.map(call => call.serviceId), ["svc-polyadic", "svc-mock"]);
    assert.deepEqual(outcomes, [
        { serviceId: "svc-polyadic", status: "delivered" },
        { serviceId: "svc-mock", status: "delivered" },
    ]);
    assert.deepEqual(policyReads, ["session:10", "version:2"], "the session's pinned version applies");
});

test("dispatchEphemeralHook creates no job and passes no job id, callback or result collection", async () => {
    const { registry, calls, jobsCalls } = makeRegistry();

    await registry.dispatchEphemeralHook(HOOK, CONTEXT, { enabledServiceIds: REQUESTED });

    assert.deepEqual(jobsCalls, [], "the jobs service is never called");
    for (const { serviceId, args } of calls) {
        assert.equal(args.length, 1, "the handler receives its context only");
        const [context] = args;
        assert.deepEqual(context, { ...CONTEXT, serviceId });
        assert.ok(Object.isFrozen(context));
        for (const key of ["jobId", "correlationId", "callback", "enabledServiceIds", "serviceConfiguration"]) {
            assert.equal(Object.hasOwn(context, key), false, `${key} is not injected`);
        }
    }
});

test("dispatchEphemeralHook forwards only the contract's fields", async () => {
    const { registry, calls } = makeRegistry();

    await registry.dispatchEphemeralHook(HOOK, {
        ...CONTEXT,
        content:    "a draft",
        text:       "a draft",
        length:     7,
        key:        "a",
        clientTime: "2026-11-12T15:04:00.000Z",
        role:       "A",
    }, { enabledServiceIds: ["svc-mock"] });

    assert.deepEqual(Object.keys(calls[0].args[0]).sort(), [
        "groupId", "kind", "phaseId", "questionId", "receivedAt", "serviceId", "sessionId", "ttlSeconds", "userId",
    ]);
});

test("dispatchEphemeralHook isolates a handler that throws or rejects", async () => {
    const delivered = [];
    const { registry } = makeRegistry({
        handlers: {
            "svc-polyadic": () => {
                throw Object.assign(new Error("draft text in an error"), { code: "ECONNRESET", statusCode: 503 });
            },
            "svc-mock": async (context) => { delivered.push(context.serviceId); },
        },
    });

    const { result: outcomes, warnings } = await captureWarnings(() =>
        registry.dispatchEphemeralHook(HOOK, CONTEXT, { enabledServiceIds: REQUESTED }));

    assert.deepEqual(outcomes, [
        { serviceId: "svc-polyadic", status: "failed" },
        { serviceId: "svc-mock", status: "delivered" },
    ]);
    assert.deepEqual(delivered, ["svc-mock"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /An ephemeral hook handler failed/u);
    assert.doesNotMatch(warnings[0], /draft text/u, "the error message is never logged");
});

test("dispatchEphemeralHook logs a failure with ids and the error's name and code only", async () => {
    const logged = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { logged.push(args); };
    try {
        const { registry } = makeRegistry({
            handlers: {
                "svc-mock": async () => {
                    throw Object.assign(new TypeError("draft text"), { code: "E_BRIDGE", statusCode: 502 });
                },
            },
        });
        await registry.dispatchEphemeralHook(HOOK, CONTEXT, { enabledServiceIds: ["svc-mock"] });
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0][1], {
        hookName:   HOOK,
        serviceId:  "svc-mock",
        sessionId:  10,
        phaseId:    20,
        groupId:    40,
        errorName:  "TypeError",
        errorCode:  "E_BRIDGE",
        statusCode: 502,
    });
});

test("dispatchEphemeralHook without a connection reaches development adapters only", async () => {
    const { registry, calls } = makeRegistry({ connected: false });

    await registry.dispatchEphemeralHook(HOOK, CONTEXT, { enabledServiceIds: REQUESTED });

    assert.deepEqual(calls.map(call => call.serviceId), ["svc-mock"]);
});

test("dispatchEphemeralHook with an unreadable policy reaches development adapters only", async () => {
    const { registry, calls } = makeRegistry({ failPolicy: true });

    const { warnings } = await captureWarnings(async () => {
        const originalError = console.error;
        console.error = () => {};
        try {
            await registry.dispatchEphemeralHook(HOOK, CONTEXT, { enabledServiceIds: REQUESTED });
        } finally {
            console.error = originalError;
        }
    });

    assert.deepEqual(calls.map(call => call.serviceId), ["svc-mock"]);
    assert.deepEqual(warnings, []);
});

test("dispatchEphemeralHook without requested services calls nothing and reads no policy", async () => {
    const { registry, calls, policyReads } = makeRegistry();

    // An activity launched with its AI services off enables none (#970).
    assert.deepEqual(await registry.dispatchEphemeralHook(HOOK, CONTEXT, { enabledServiceIds: [] }), []);
    assert.deepEqual(await registry.dispatchEphemeralHook(HOOK, CONTEXT), []);
    assert.deepEqual(await registry.dispatchEphemeralHook(HOOK, CONTEXT, { enabledServiceIds: ["svc-silent"] }), []);
    assert.deepEqual(calls, []);
    assert.deepEqual(policyReads, []);
});

test("dispatchEphemeralHook rejects hooks outside EPHEMERAL_HOOKS before calling anything", async () => {
    const { registry, calls, jobsCalls, policyReads } = makeRegistry();

    for (const hookName of ["chat-message-received", "report-building", "student-results-reading", "unknown"]) {
        await assert.rejects(
            registry.dispatchEphemeralHook(hookName, CONTEXT, { enabledServiceIds: REQUESTED }),
            TypeError
        );
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(jobsCalls, []);
    assert.deepEqual(policyReads, []);
});

test("dispatchEphemeralHook rejects an invalid context before calling anything", async () => {
    const { registry, calls, policyReads } = makeRegistry();

    for (const context of [
        null,
        { ...CONTEXT, kind: "typing" },
        { ...CONTEXT, kind: undefined },
        { ...CONTEXT, groupId: "40" },
        { ...CONTEXT, userId: 0 },
        { ...CONTEXT, questionId: undefined },
        { ...CONTEXT, receivedAt: undefined },
        { ...CONTEXT, receivedAt: "not a date" },
        { ...CONTEXT, ttlSeconds: 0 },
        { ...CONTEXT, ttlSeconds: 121 },
        { ...CONTEXT, ttlSeconds: 2.5 },
    ]) {
        await assert.rejects(
            registry.dispatchEphemeralHook(HOOK, context, { enabledServiceIds: REQUESTED }),
            TypeError,
            JSON.stringify(context)
        );
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(policyReads, []);
});

test("normalizeParticipantActivityContext defaults the TTL and normalizes the receipt time", () => {
    const { ttlSeconds, ...withoutTtl } = CONTEXT;
    assert.equal(ttlSeconds, 30);

    const context = normalizeParticipantActivityContext({
        ...withoutTtl,
        kind:       "stopped",
        receivedAt: new Date(RECEIVED_AT),
    });

    assert.deepEqual(context, { ...CONTEXT, kind: "stopped", ttlSeconds: 30 });
    assert.equal(normalizeParticipantActivityContext({
        ...CONTEXT,
        receivedAt: Date.parse(RECEIVED_AT),
        ttlSeconds: 120,
    }).receivedAt, RECEIVED_AT);
});

test("dispatchHook refuses participant-activity and creates no job", async () => {
    const { registry, calls, jobsCalls, policyReads } = makeRegistry();

    const { result, warnings } = await captureWarnings(() =>
        registry.dispatchHook(HOOK, CONTEXT, { enabledServiceIds: REQUESTED }));

    assert.deepEqual(result, []);
    assert.deepEqual(calls, []);
    assert.deepEqual(jobsCalls, []);
    assert.deepEqual(policyReads, []);
    assert.ok(warnings.some(warning => warning.includes("is not dispatched through dispatchHook()")));
});

test("dispatchGlobalHook refuses participant-activity too", async () => {
    const { registry, calls, jobsCalls } = makeRegistry();

    const { result } = await captureWarnings(() => registry.dispatchGlobalHook(HOOK, CONTEXT, {
        serviceIds: REQUESTED,
    }));

    assert.deepEqual(result, []);
    assert.deepEqual(calls, []);
    assert.deepEqual(jobsCalls, []);
});

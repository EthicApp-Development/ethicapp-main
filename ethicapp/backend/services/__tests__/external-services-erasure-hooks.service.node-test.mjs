// Erasure hooks (#876): `user-forgotten` reaches every registered adapter
// that declares it, whatever the AI service policy, as long as a usable AI
// Additions connection is stored; dispatchGlobalHook can narrow it to one
// service at a time.
import assert from "node:assert/strict";
import test from "node:test";

import {
    ERASURE_HOOKS,
    ExternalServicesRegistry,
    NON_SESSION_HOOKS,
} from "../external-services.service.js";

const HOOK = "user-forgotten";

function makeRegistry({ connected = true, allowedServiceIds = [] } = {}) {
    const policyReads = [];
    const createdJobs = [];
    const registry = new ExternalServicesRegistry({
        developmentAdapters:     false,
        isAiAdditionsConfigured: async () => connected,
        aiServicePolicy:         {
            async getCurrentPolicyVersion() {
                policyReads.push("current");
                return { id: 1, allowedServiceIds, disabledAdapterIds: ["tutor-adapter"] };
            },
            async getPolicyVersion() {
                return null;
            },
            async getSessionPolicyVersionId() {
                return null;
            },
        },
        roomJobsService: { closeRoomJobs: async () => 0 },
        jobsService:     {
            createJob:       async args => { createdJobs.push(args); return { id: `job-${createdJobs.length}` }; },
            updateJobStatus: async () => {},
        },
    });
    registry.initialized = true;

    for (const [id, requires] of [
        ["tutor-adapter", ["argumentation-tutor"]],
        ["polyadic-adapter", ["polyadic-agent"]],
        ["case-adapter", ["case-analyst"]],
    ]) {
        registry.services.set(id, {
            id,
            development: false,
            requires,
            hooks:       id === "case-adapter" ? ["case-created"] : [HOOK],
            globalHooks: id === "case-adapter" ? ["case-created"] : [HOOK],
            scopes:      [],
        });
    }

    const called = [];
    registry.hookSubscribers.set(HOOK, ["tutor-adapter", "polyadic-adapter"].map(serviceId => ({
        serviceId,
        handler: async (context) => {
            called.push(`${serviceId}:${context.userId}`);
            if (serviceId === "polyadic-adapter" && context.failPolyadic) {
                throw Object.assign(new Error("unavailable"), { statusCode: 503 });
            }
            return { status: "completed" };
        },
    })));

    return { registry, called, createdJobs, policyReads };
}

test("user-forgotten is a non-session erasure hook", () => {
    assert.ok(NON_SESSION_HOOKS.includes(HOOK));
    assert.deepEqual(ERASURE_HOOKS, [HOOK]);
});

test("user-forgotten skips the policy: adapters the policy switches off still receive it", async () => {
    const { registry, called, policyReads } = makeRegistry({ allowedServiceIds: [] });

    const outcomes = await registry.dispatchGlobalHook(HOOK, { userId: 42 });

    assert.deepEqual(called.sort(), ["polyadic-adapter:42", "tutor-adapter:42"]);
    assert.deepEqual(outcomes.map(outcome => outcome.status), ["fulfilled", "fulfilled"]);
    assert.deepEqual(policyReads, [], "the policy is not read");
});

test("user-forgotten needs a usable AI Additions connection", async () => {
    const { registry, called } = makeRegistry({ connected: false });

    const outcomes = await registry.dispatchGlobalHook(HOOK, { userId: 42 });

    assert.deepEqual(outcomes, []);
    assert.deepEqual(called, []);
});

test("dispatchGlobalHook narrows the audience to the given services and reports their outcome", async () => {
    const { registry, called, createdJobs } = makeRegistry();

    const outcomes = await registry.dispatchGlobalHook(
        HOOK,
        { userId: 42, failPolyadic: true },
        { serviceIds: ["polyadic-adapter"] }
    );

    assert.deepEqual(called, ["polyadic-adapter:42"]);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].status, "rejected");
    assert.equal(outcomes[0].reason.statusCode, 503);
    assert.deepEqual(createdJobs.map(job => [job.serviceId, job.hookName, job.userId]), [
        ["polyadic-adapter", HOOK, 42],
    ]);
});

test("globalHookServiceIds lists the registered services that declare a global hook", () => {
    const { registry } = makeRegistry();

    assert.deepEqual(registry.globalHookServiceIds(HOOK), ["tutor-adapter", "polyadic-adapter"]);
    assert.deepEqual(registry.globalHookServiceIds("case-created"), ["case-adapter"]);
});

test("other global hooks still follow the policy", async () => {
    const { registry, policyReads } = makeRegistry({ allowedServiceIds: [] });
    registry.hookSubscribers.set("case-created", [{
        serviceId: "case-adapter",
        handler:   async () => ({ status: "completed" }),
    }]);

    const outcomes = await registry.dispatchGlobalHook("case-created", { caseId: 3 });

    assert.deepEqual(outcomes, []);
    assert.deepEqual(policyReads, ["current"]);
});

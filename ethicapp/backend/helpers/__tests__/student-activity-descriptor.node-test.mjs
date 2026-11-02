import assert from "node:assert/strict";
import test from "node:test";
import {
    STUDENT_ACTIVITY_DESCRIPTOR_SQL,
    getCachedStudentActivityDescriptorWith,
    invalidateStudentActivityDescriptorWith,
    isCacheableStudentActivityDescriptor,
    studentActivityDescriptorCacheKey,
    studentUsableServices,
} from "../student-activity-descriptor.js";

function fakeRedis(entries = {}) {
    const store = new Map(Object.entries(entries));
    const calls = [];
    return {
        store,
        calls,
        async get(key) {
            calls.push(["get", key]);
            return store.get(key) ?? null;
        },
        async set(key, value, ...options) {
            calls.push(["set", key, ...options]);
            store.set(key, value);
        },
        async del(key) {
            calls.push(["del", key]);
            store.delete(key);
        },
    };
}

const DESCRIPTOR = {
    descriptor: {
        description:        "",
        design:             { phases: [] },
        currentPhaseId:     7,
        currentPhaseNumber: 1,
    },
};
const FINISHED_DESCRIPTOR = {
    descriptor: {
        description:        "",
        design:             { phases: [] },
        currentPhaseId:     null,
        currentPhaseNumber: null,
    },
};
const cachedOne = (key, value) => fakeRedis({ [key]: JSON.stringify(value) });

test("studentActivityDescriptorCacheKey: uses the v2 key", () => {
    assert.equal(studentActivityDescriptorCacheKey("12"), "descriptor:12:v2");
});

test("descriptor query: left joins the current phase, which a finished activity lacks", () => {
    assert.match(
        STUDENT_ACTIVITY_DESCRIPTOR_SQL,
        /LEFT JOIN\s+stages st ON st\.id = s\.current_stage/
    );
});

test("isCacheableStudentActivityDescriptor: only descriptors with a design", () => {
    assert.equal(isCacheableStudentActivityDescriptor(DESCRIPTOR), true);
    assert.equal(isCacheableStudentActivityDescriptor(FINISHED_DESCRIPTOR), true);
    assert.equal(isCacheableStudentActivityDescriptor({ descriptor: {} }), false);
    assert.equal(isCacheableStudentActivityDescriptor(null), false);
});

test("getCachedStudentActivityDescriptorWith: returns a cached descriptor unloaded", async () => {
    const redis = cachedOne("descriptor:12:v2", DESCRIPTOR);
    const result = await getCachedStudentActivityDescriptorWith(
        { redis, load: async () => assert.fail("must not load") },
        12
    );
    assert.deepEqual(result, DESCRIPTOR);
});

test("getCachedStudentActivityDescriptorWith: caches a loaded descriptor for an hour", async () => {
    const redis = fakeRedis();
    const load = async () => FINISHED_DESCRIPTOR;
    const result = await getCachedStudentActivityDescriptorWith({ redis, load }, 12);
    assert.deepEqual(result, FINISHED_DESCRIPTOR);
    assert.deepEqual(JSON.parse(redis.store.get("descriptor:12:v2")), FINISHED_DESCRIPTOR);
    assert.deepEqual(redis.calls.at(-1), ["set", "descriptor:12:v2", "EX", 3600]);
});

test("getCachedStudentActivityDescriptorWith: never caches an empty descriptor", async () => {
    const redis = fakeRedis();
    const load = async () => ({ descriptor: {} });
    const result = await getCachedStudentActivityDescriptorWith({ redis, load }, 12);
    assert.deepEqual(result, { descriptor: {} });
    assert.equal(redis.store.has("descriptor:12:v2"), false);
    assert.equal(redis.calls.some(([op]) => op === "set"), false);
});

test("getCachedStudentActivityDescriptorWith: invalidate drops the entry and reloads", async () => {
    const redis = cachedOne("descriptor:12:v2", DESCRIPTOR);
    const result = await getCachedStudentActivityDescriptorWith(
        { redis, load: async () => FINISHED_DESCRIPTOR },
        12,
        true
    );
    assert.deepEqual(result, FINISHED_DESCRIPTOR);
    assert.deepEqual(redis.calls[0], ["del", "descriptor:12:v2"]);
    assert.deepEqual(JSON.parse(redis.store.get("descriptor:12:v2")), FINISHED_DESCRIPTOR);
});

test("invalidateStudentActivityDescriptorWith: deletes the v2 key", async () => {
    const redis = cachedOne("descriptor:12:v2", DESCRIPTOR);
    await invalidateStudentActivityDescriptorWith(redis, "12");
    assert.equal(redis.store.has("descriptor:12:v2"), false);
});

// The student app's services (#970): with the AI services turned off at
// launch it gets none, so it never waits for a response processing.
function fakeServiceRegistry() {
    const calls = [];
    return {
        calls,
        async initialize() {
            calls.push(["initialize"]);
        },
        async getSessionPolicyVersion(sessionId) {
            calls.push(["getSessionPolicyVersion", sessionId]);
            return { id: 4 };
        },
        async listUsableServices(options) {
            calls.push(["listUsableServices", options]);
            return [{ id: "reviewer", scopes: ["response"] }];
        },
    };
}

test("STUDENT_ACTIVITY_DESCRIPTOR_SQL: reads the session's AI services switch (#970)", () => {
    assert.match(STUDENT_ACTIVITY_DESCRIPTOR_SQL, /s\.ai_services_enabled/);
});

test("studentUsableServices: the session's usable services when its AI services are on", async () => {
    for (const row of [{ ai_services_enabled: true }, {}]) {
        const registry = fakeServiceRegistry();

        const services = await studentUsableServices(row, 12, registry);

        assert.deepEqual(services, [{ id: "reviewer", scopes: ["response"] }]);
        assert.deepEqual(registry.calls, [
            ["initialize"],
            ["getSessionPolicyVersion", 12],
            ["listUsableServices", { policyVersion: { id: 4 } }],
        ]);
    }
});

test("studentUsableServices: none, unread, when the AI services were turned off (#970)", async () => {
    const registry = fakeServiceRegistry();

    assert.deepEqual(await studentUsableServices({ ai_services_enabled: false }, 12, registry), []);
    assert.deepEqual(registry.calls, []);
});

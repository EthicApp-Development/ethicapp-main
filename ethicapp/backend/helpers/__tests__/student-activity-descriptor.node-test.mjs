import assert from "node:assert/strict";
import test from "node:test";
import {
    STUDENT_ACTIVITY_DESCRIPTOR_SQL,
    getCachedStudentActivityDescriptorWith,
    invalidateStudentActivityDescriptorWith,
    isCacheableStudentActivityDescriptor,
    studentActivityDescriptorCacheKey,
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

import assert from "node:assert/strict";
import test from "node:test";

import {
    classifyErasureError,
    createUserErasureProcessor,
    RETRY_BASE_DELAY_MS,
    RETRY_MAX_DELAY_MS,
    retryDelayMs,
    USER_FORGOTTEN_HOOK,
} from "../user-erasure-processor.js";

const silentLogger = { info() {}, warn() {}, error() {} };

// A store over an in-memory list of requests; claims return due pending ones.
function makeStore(requests) {
    const calls = [];
    return {
        calls,
        async claimDue({ limit, userId }) {
            calls.push(["claim", userId]);
            const due = requests.filter(request => request.status === "pending" && !request.claimed
                && (userId === null || request.userId === userId)).slice(0, limit);
            due.forEach(request => { request.claimed = true; });
            return due.map(request => ({ ...request }));
        },
        async markDone(id) {
            calls.push(["done", id]);
            Object.assign(requests.find(request => request.id === id), { status: "done" });
        },
        async markRetry(id, code, delayMs) {
            calls.push(["retry", id, code, delayMs]);
        },
        async markFailed(id, code) {
            calls.push(["failed", id, code]);
            Object.assign(requests.find(request => request.id === id), { status: "failed" });
        },
    };
}

function makeRegistry({ connected = true, outcomeFor = () => ({ status: "fulfilled", value: {} }) } = {}) {
    const dispatched = [];
    const services = new Map([
        ["argumentation-tutor-system", { id: "argumentation-tutor-system", requires: ["argumentation-tutor"] }],
        ["polyadic-devils-advocate", { id: "polyadic-devils-advocate", requires: ["polyadic-agent"] }],
    ]);
    return {
        dispatched,
        initialized: true,
        async initialize() {},
        globalHookServiceIds(hookName) {
            return hookName === USER_FORGOTTEN_HOOK ? [...services.keys()] : [];
        },
        getServiceById(id) {
            return services.get(id) ?? null;
        },
        async hasAiAdditionsConnection() {
            return connected;
        },
        async dispatchGlobalHook(hookName, context, { serviceIds }) {
            dispatched.push([hookName, context.userId, serviceIds]);
            return serviceIds.map(serviceId => outcomeFor(serviceId));
        },
    };
}

function request(id, serviceId, { userId = 42, attempts = 0 } = {}) {
    return { id, userId, serviceId, status: "pending", attempts };
}

test("retryDelayMs doubles from one minute and stops at six hours", () => {
    assert.equal(retryDelayMs(1), RETRY_BASE_DELAY_MS);
    assert.equal(retryDelayMs(2), 2 * RETRY_BASE_DELAY_MS);
    assert.equal(retryDelayMs(5), 16 * RETRY_BASE_DELAY_MS);
    assert.equal(retryDelayMs(9), 256 * RETRY_BASE_DELAY_MS);
    assert.equal(retryDelayMs(10), RETRY_MAX_DELAY_MS);
    assert.equal(retryDelayMs(500), RETRY_MAX_DELAY_MS);
});

test("classifyErasureError records codes, never messages, and gives up only on what a retry cannot fix", () => {
    assert.deepEqual(classifyErasureError({ code: "not_configured" }), { code: "NOT_CONFIGURED", retryable: true });
    assert.deepEqual(classifyErasureError({ code: "credentials_missing" }), { code: "CREDENTIALS_MISSING", retryable: true });
    assert.deepEqual(classifyErasureError({ code: "invalid_user_id" }), { code: "INVALID_USER_ID", retryable: false });
    assert.deepEqual(classifyErasureError({ statusCode: 503 }), { code: "HTTP_503", retryable: true });
    assert.deepEqual(classifyErasureError({ statusCode: 404 }), { code: "HTTP_404", retryable: true });
    assert.deepEqual(classifyErasureError({ statusCode: 401 }), { code: "HTTP_401", retryable: true });
    assert.deepEqual(classifyErasureError({ statusCode: 400 }), { code: "HTTP_400", retryable: false });
    assert.deepEqual(classifyErasureError({ name: "AbortError" }), { code: "TIMEOUT", retryable: true });
    assert.deepEqual(classifyErasureError(new TypeError("fetch failed")), { code: "UNREACHABLE", retryable: true });
});

test("each request is dispatched to the adapters of its service only, and done when they confirm", async () => {
    const requests = [request(1, "argumentation-tutor"), request(2, "polyadic-agent")];
    const store = makeStore(requests);
    const registry = makeRegistry();
    const processor = createUserErasureProcessor({ registry, store, logger: silentLogger });

    const summary = await processor.processDue();

    assert.deepEqual(summary, { done: 2, retrying: 0, failed: 0 });
    assert.deepEqual(registry.dispatched, [
        [USER_FORGOTTEN_HOOK, 42, ["argumentation-tutor-system"]],
        [USER_FORGOTTEN_HOOK, 42, ["polyadic-devils-advocate"]],
    ]);
    assert.deepEqual(store.calls.filter(call => call[0] === "done"), [["done", 1], ["done", 2]]);
});

test("a failing service is retried with backoff and does not hold back the others", async () => {
    const requests = [request(1, "argumentation-tutor"), request(2, "polyadic-agent", { attempts: 3 })];
    const store = makeStore(requests);
    const registry = makeRegistry({
        outcomeFor: serviceId => serviceId === "polyadic-devils-advocate"
            ? { status: "rejected", reason: Object.assign(new Error("HTTP 503"), { statusCode: 503 }) }
            : { status: "fulfilled", value: {} },
    });
    const processor = createUserErasureProcessor({ registry, store, logger: silentLogger });

    const summary = await processor.processDue();

    assert.deepEqual(summary, { done: 1, retrying: 1, failed: 0 });
    assert.deepEqual(store.calls.filter(call => call[0] !== "claim"), [
        ["done", 1],
        // The fourth failed attempt waits 2^3 minutes.
        ["retry", 2, "HTTP_503", 8 * RETRY_BASE_DELAY_MS],
    ]);
});

test("without an AI Additions connection the requests stay pending, with a retry scheduled", async () => {
    const requests = [request(1, "argumentation-tutor"), request(2, "polyadic-agent")];
    const store = makeStore(requests);
    const registry = makeRegistry({ connected: false });
    const processor = createUserErasureProcessor({ registry, store, logger: silentLogger });

    const summary = await processor.processDue();

    assert.deepEqual(summary, { done: 0, retrying: 2, failed: 0 });
    assert.deepEqual(registry.dispatched, []);
    assert.deepEqual(store.calls.filter(call => call[0] === "retry").map(call => call[2]), [
        "NOT_CONFIGURED", "NOT_CONFIGURED",
    ]);
});

test("a refusal a retry cannot fix, or a service without adapter, fails the request", async () => {
    const requests = [request(1, "argumentation-tutor"), request(2, "unknown-service")];
    const store = makeStore(requests);
    const registry = makeRegistry({
        outcomeFor: () => ({ status: "rejected", reason: { statusCode: 400 } }),
    });
    const processor = createUserErasureProcessor({ registry, store, logger: silentLogger });

    const summary = await processor.processDue();

    assert.deepEqual(summary, { done: 0, retrying: 0, failed: 2 });
    assert.deepEqual(store.calls.filter(call => call[0] === "failed"), [
        ["failed", 1, "HTTP_400"],
        ["failed", 2, "NO_ADAPTER"],
    ]);
});

test("processDue can be limited to one user", async () => {
    const requests = [request(1, "argumentation-tutor", { userId: 7 }), request(2, "argumentation-tutor", { userId: 8 })];
    const store = makeStore(requests);
    const registry = makeRegistry();
    const processor = createUserErasureProcessor({ registry, store, logger: silentLogger });

    await processor.processDue({ userId: 8 });

    assert.deepEqual(registry.dispatched.map(entry => entry[1]), [8]);
    assert.equal(requests[0].status, "pending");
});

test("claims continue in batches until no request is due", async () => {
    const requests = Array.from({ length: 5 }, (_, index) => request(index + 1, "argumentation-tutor"));
    const store = makeStore(requests);
    const processor = createUserErasureProcessor({
        registry: makeRegistry(), store, logger: silentLogger, batchSize: 2,
    });

    const summary = await processor.processDue();

    assert.equal(summary.done, 5);
    assert.equal(store.calls.filter(call => call[0] === "claim").length, 3);
});

test("start schedules ticks with the interval and stop cancels them", async () => {
    const scheduled = [];
    const cleared = [];
    const timers = {
        setTimeout(callback, delayMs) {
            const handle = { callback, delayMs };
            scheduled.push(handle);
            return handle;
        },
        clearTimeout(handle) {
            cleared.push(handle);
        },
    };
    const requests = [request(1, "argumentation-tutor")];
    const store = makeStore(requests);
    const processor = createUserErasureProcessor({
        registry: makeRegistry(), store, logger: silentLogger, intervalMs: 30000, timers,
    });

    processor.start({ firstDelayMs: 10 });
    processor.start();
    assert.deepEqual(scheduled.map(handle => handle.delayMs), [10], "a second start is a no-op");

    await scheduled[0].callback();
    assert.equal(requests[0].status, "done");
    assert.deepEqual(scheduled.map(handle => handle.delayMs), [10, 30000]);

    await processor.stop();
    assert.deepEqual(cleared, [scheduled[1]]);
});

test("a failed tick is logged and the next one is still scheduled", async () => {
    const scheduled = [];
    const errors = [];
    const timers = {
        setTimeout(callback, delayMs) {
            scheduled.push({ callback, delayMs });
            return {};
        },
        clearTimeout() {},
    };
    const store = {
        async claimDue() {
            throw new Error("database unavailable");
        },
    };
    const processor = createUserErasureProcessor({
        registry: makeRegistry(),
        store,
        logger:   { ...silentLogger, error: message => errors.push(message) },
        timers,
    });

    processor.start({ firstDelayMs: 0 });
    await scheduled[0].callback();

    assert.equal(errors.length, 1);
    assert.equal(scheduled.length, 2);
    await processor.stop();
});

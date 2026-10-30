// Integration tests for the user erasure requests (V31, #876), against a real
// PostgreSQL database with migrations V1-V31 applied: the processor's claim,
// its retries with backoff, the lease that makes it survive a crash or a
// restart, and an administrator's retry. The AI Additions side is a fake
// registry; the requests are real rows.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. Each test uses user ids of its own, and every
// processing is limited to them, so rows of other tests or earlier runs are
// never touched.

import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import test from "node:test";
import pg from "pg";

import {
    CLAIM_LEASE_MS,
    createUserErasureProcessor,
    RETRY_BASE_DELAY_MS,
    USER_FORGOTTEN_HOOK,
} from "../user-erasure-processor.js";
import { UserErasureRequestsStore } from "../user-erasure-requests.store.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
    return pool;
}

const dbQuery = async (sql, params = []) => (await getPool().query(sql, params)).rows;

test.after(async () => {
    await pool?.end();
});

const silentLogger = { info() {}, warn() {}, error() {} };

function newUserId() {
    return randomInt(100_000_000, 2_000_000_000);
}

async function insertRequests(userId, serviceIds = ["argumentation-tutor", "polyadic-agent"]) {
    await dbQuery(
        `INSERT INTO user_erasure_requests (user_id, service_id)
         SELECT $1, unnest($2::text[])`,
        [userId, serviceIds]
    );
}

async function requestsOf(userId) {
    return dbQuery(
        `SELECT service_id, status, attempts, last_error, completed_at IS NOT NULL AS completed,
                EXTRACT(EPOCH FROM (next_attempt_at - now())) * 1000 AS due_in_ms
         FROM user_erasure_requests
         WHERE user_id = $1
         ORDER BY service_id`,
        [userId]
    );
}

// Makes the user's pending requests due now, as time passing would.
async function makeDue(userId) {
    await dbQuery(
        "UPDATE user_erasure_requests SET next_attempt_at = now() WHERE user_id = $1 AND status = 'pending'",
        [userId]
    );
}

// A registry whose adapters answer with `outcome(serviceId)`.
function makeRegistry(outcome) {
    const services = new Map([
        ["argumentation-tutor-system", { requires: ["argumentation-tutor"] }],
        ["polyadic-devils-advocate", { requires: ["polyadic-agent"] }],
    ]);
    const dispatched = [];
    return {
        dispatched,
        initialized: true,
        globalHookServiceIds: hookName => (hookName === USER_FORGOTTEN_HOOK ? [...services.keys()] : []),
        getServiceById:       id => services.get(id) ?? null,
        hasAiAdditionsConnection: async () => true,
        async dispatchGlobalHook(hookName, context, { serviceIds }) {
            dispatched.push([context.userId, ...serviceIds]);
            return serviceIds.map(outcome);
        },
    };
}

const ok = () => ({ status: "fulfilled", value: { status: "completed" } });
const unavailable = () => ({
    status: "rejected",
    reason: Object.assign(new Error("HTTP 503"), { statusCode: 503 }),
});

function processorWith(registry) {
    return createUserErasureProcessor({
        registry,
        store:  new UserErasureRequestsStore({ dbQuery }),
        logger: silentLogger,
    });
}

function assertDueIn(actualMs, expectedMs) {
    // The statement's now() and the check's now() are a few ms apart.
    assert.ok(Math.abs(Number(actualMs) - expectedMs) < 5000, `due in ${actualMs} ms, expected ${expectedMs}`);
}

test("V31: a failing service is retried with a growing backoff until it confirms", {
    skip: SKIP_REASON,
}, async () => {
    const userId = newUserId();
    await insertRequests(userId);
    let polyadicOutcome = unavailable;
    const registry = makeRegistry(serviceId => (
        serviceId === "polyadic-devils-advocate" ? polyadicOutcome() : ok()
    ));
    const processor = processorWith(registry);

    assert.deepEqual(await processor.processDue({ userId }), { done: 1, retrying: 1, failed: 0 });
    let [tutor, polyadic] = await requestsOf(userId);
    assert.deepEqual([tutor.status, tutor.attempts, tutor.completed], ["done", 1, true]);
    assert.deepEqual([polyadic.status, polyadic.attempts, polyadic.last_error], ["pending", 1, "HTTP_503"]);
    assertDueIn(polyadic.due_in_ms, RETRY_BASE_DELAY_MS);

    // Not due yet: nothing is attempted.
    assert.deepEqual(await processor.processDue({ userId }), { done: 0, retrying: 0, failed: 0 });

    await makeDue(userId);
    assert.deepEqual(await processor.processDue({ userId }), { done: 0, retrying: 1, failed: 0 });
    [, polyadic] = await requestsOf(userId);
    assert.equal(polyadic.attempts, 2);
    assertDueIn(polyadic.due_in_ms, 2 * RETRY_BASE_DELAY_MS);

    await makeDue(userId);
    polyadicOutcome = ok;
    assert.deepEqual(await processor.processDue({ userId }), { done: 1, retrying: 0, failed: 0 });
    [, polyadic] = await requestsOf(userId);
    assert.deepEqual(
        [polyadic.status, polyadic.attempts, polyadic.last_error, polyadic.completed],
        ["done", 3, null, true]
    );
    // UPDATE ... RETURNING does not keep the claim's order, so the first
    // attempt may send either service first.
    assert.deepEqual(registry.dispatched.map(entry => entry[1]).sort(), [
        "argumentation-tutor-system",
        "polyadic-devils-advocate",
        "polyadic-devils-advocate",
        "polyadic-devils-advocate",
    ]);
});

test("V31: a request whose attempt was cut short is due again once its lease ends", {
    skip: SKIP_REASON,
}, async () => {
    const userId = newUserId();
    await insertRequests(userId, ["argumentation-tutor"]);
    const store = new UserErasureRequestsStore({ dbQuery });

    // A process claims the request and dies before recording an outcome.
    const [claimed] = await store.claimDue({ limit: 10, leaseMs: CLAIM_LEASE_MS, userId });
    assert.equal(claimed.serviceId, "argumentation-tutor");
    let [request] = await requestsOf(userId);
    assert.deepEqual([request.status, request.attempts], ["pending", 0]);
    assertDueIn(request.due_in_ms, CLAIM_LEASE_MS);

    // A restarted process does not take it while the lease lasts...
    const restarted = processorWith(makeRegistry(ok));
    assert.deepEqual(await restarted.processDue({ userId }), { done: 0, retrying: 0, failed: 0 });

    // ...and sends it once the lease ends.
    await makeDue(userId);
    assert.deepEqual(await restarted.processDue({ userId }), { done: 1, retrying: 0, failed: 0 });
    [request] = await requestsOf(userId);
    assert.equal(request.status, "done");
});

test("V31: concurrent claims never take the same request", { skip: SKIP_REASON }, async () => {
    const userId = newUserId();
    const serviceIds = Array.from({ length: 6 }, (_, index) => `svc-claim-${index}`);
    await insertRequests(userId, serviceIds);
    const stores = [1, 2, 3].map(() => new UserErasureRequestsStore({ dbQuery }));

    const claims = await Promise.all(stores.map(store => store.claimDue({
        limit: 4, leaseMs: CLAIM_LEASE_MS, userId,
    })));

    const claimedIds = claims.flat().map(request => request.serviceId);
    assert.equal(new Set(claimedIds).size, claimedIds.length, "no request is claimed twice");
    assert.equal(claimedIds.length, serviceIds.length);
});

test("V31: a refusal fails the request until an administrator retries it", {
    skip: SKIP_REASON,
}, async () => {
    const userId = newUserId();
    await insertRequests(userId, ["argumentation-tutor"]);
    const store = new UserErasureRequestsStore({ dbQuery });
    let outcome = () => ({ status: "rejected", reason: { statusCode: 400 } });
    const processor = processorWith(makeRegistry(() => outcome()));

    assert.deepEqual(await processor.processDue({ userId }), { done: 0, retrying: 0, failed: 1 });
    let [request] = await requestsOf(userId);
    assert.deepEqual([request.status, request.last_error], ["failed", "HTTP_400"]);
    await makeDue(userId);
    assert.deepEqual(await processor.processDue({ userId }), { done: 0, retrying: 0, failed: 0 });

    assert.equal(await store.resetForRetry(userId), 1);
    [request] = await requestsOf(userId);
    assert.deepEqual([request.status, request.attempts, request.last_error], ["pending", 0, "HTTP_400"]);

    outcome = ok;
    assert.deepEqual(await processor.processDue({ userId }), { done: 1, retrying: 0, failed: 0 });
    assert.equal(await store.resetForRetry(userId), 0, "a done request is never reset");
    const listed = await store.listForUser(userId);
    assert.deepEqual(listed.map(item => [item.serviceId, item.status, item.attempts]), [
        ["argumentation-tutor", "done", 1],
    ]);
});

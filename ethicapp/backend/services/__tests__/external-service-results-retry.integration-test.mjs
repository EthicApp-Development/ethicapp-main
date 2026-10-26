// Integration tests for pending callback results (#815), against a real
// PostgreSQL database with migrations V1-V23 applied: the status CHECK and
// the concurrent claim of a pending result cannot be checked with fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { ExternalServiceJobsService, RESULT_STATUS } from "../external-service-jobs.service.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
    return pool;
}

function makeService() {
    return new ExternalServiceJobsService({
        dbQuery: async (sql, params = []) => (await getPool().query(sql, params)).rows,
    });
}

test.after(async () => {
    await pool?.end();
});

const SERVICE_ID = "polyadic-devils-advocate";

function receive(service, eventId) {
    return service.createResult({
        correlationId: randomUUID(), serviceId: SERVICE_ID, rawPayload: { room: "r" }, eventId,
    });
}

test("pending results: a received result stays pending until claimed", { skip: SKIP_REASON }, async () => {
    const service = makeService();
    const eventId = randomUUID();

    const first = await receive(service, eventId);
    assert.equal(first.status, RESULT_STATUS.PENDING);

    // A retry before any claim is processed again, on the same row.
    const retry = await receive(service, eventId);
    assert.equal(retry.is_retry, true);
    assert.equal(retry.id, first.id);
});

test("pending results: concurrent attempts at one event claim it exactly once", { skip: SKIP_REASON }, async () => {
    const service = makeService();
    const eventId = randomUUID();
    await receive(service, eventId);

    const attempts = await Promise.all(Array.from({ length: 8 }, () => receive(service, eventId)));
    assert.ok(attempts.every(result => result.is_retry === true), "all still pending");

    const claims = await Promise.all(attempts.map(result => service.claimResult(result)));
    const claimed = claims.filter(Boolean);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].status, RESULT_STATUS.UNKNOWN_CORRELATION);

    const rows = (await getPool().query(
        "SELECT status FROM external_service_results WHERE service_id = $1 AND event_id = $2",
        [SERVICE_ID, eventId]
    )).rows;
    assert.deepEqual(rows, [{ status: RESULT_STATUS.UNKNOWN_CORRELATION }]);

    const later = await receive(service, eventId);
    assert.equal(later.is_duplicate, true, "a claimed event is consumed");
});

test("pending results: terminal results are duplicates and never claimed", { skip: SKIP_REASON }, async () => {
    const service = makeService();
    for (const status of [RESULT_STATUS.FAILED, RESULT_STATUS.COMPLETED]) {
        const eventId = randomUUID();
        const first = await receive(service, eventId);
        await service.updateResult(first.id, { status });

        const retry = await receive(service, eventId);
        assert.equal(retry.is_duplicate, true, status);
        assert.equal(await service.claimResult(first), null, status);
    }
});

test("pending results: the status CHECK accepts pending and nothing unknown", { skip: SKIP_REASON }, async () => {
    const service = makeService();
    const result = await receive(service, randomUUID());

    await assert.rejects(
        service.updateResult(result.id, { status: "retryable" }),
        { code: "23514" }
    );
});

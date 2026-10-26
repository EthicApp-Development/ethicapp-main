// Integration tests for retryable callback results (#815), against a real
// PostgreSQL database with migrations V1-V23 applied: the status CHECK and
// the concurrent claim of a retryable (service_id, event_id) cannot be
// checked with fakes.
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

test("retryable results: concurrent retries of one event claim it exactly once", { skip: SKIP_REASON }, async () => {
    const service = makeService();
    const eventId = randomUUID();

    const first = await service.createResult({
        correlationId: randomUUID(), serviceId: SERVICE_ID, rawPayload: { room: "r" }, eventId,
    });
    assert.equal(first.status, RESULT_STATUS.UNKNOWN_CORRELATION);
    await service.updateResult(first.id, { status: RESULT_STATUS.RETRYABLE });

    const attempts = await Promise.all(Array.from({ length: 8 }, () => service.createResult({
        correlationId: randomUUID(), serviceId: SERVICE_ID, rawPayload: { room: "r" }, eventId,
    })));

    const claimed = attempts.filter(result => result.is_retry === true);
    const duplicates = attempts.filter(result => result.is_duplicate === true);
    assert.equal(claimed.length, 1);
    assert.equal(duplicates.length, 7);
    assert.equal(claimed[0].id, first.id, "the same row is claimed, no second row");

    const rows = (await getPool().query(
        "SELECT status, processed_at FROM external_service_results WHERE service_id = $1 AND event_id = $2",
        [SERVICE_ID, eventId]
    )).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, RESULT_STATUS.UNKNOWN_CORRELATION);
    assert.equal(rows[0].processed_at, null);
});

test("retryable results: terminal results are never claimed", { skip: SKIP_REASON }, async () => {
    const service = makeService();
    for (const status of [RESULT_STATUS.FAILED, RESULT_STATUS.COMPLETED]) {
        const eventId = randomUUID();
        const first = await service.createResult({
            serviceId: SERVICE_ID, rawPayload: {}, eventId,
        });
        await service.updateResult(first.id, { status });

        const retry = await service.createResult({ serviceId: SERVICE_ID, rawPayload: {}, eventId });
        assert.equal(retry.is_duplicate, true, status);
        assert.equal(retry.is_retry, undefined, status);
    }
});

test("retryable results: the status CHECK accepts retryable and nothing unknown", { skip: SKIP_REASON }, async () => {
    const service = makeService();
    const result = await service.createResult({ serviceId: SERVICE_ID, rawPayload: {}, eventId: randomUUID() });

    await service.updateResult(result.id, { status: RESULT_STATUS.RETRYABLE });
    await assert.rejects(
        service.updateResult(result.id, { status: "claimed-somewhere" }),
        { code: "23514" }
    );
});

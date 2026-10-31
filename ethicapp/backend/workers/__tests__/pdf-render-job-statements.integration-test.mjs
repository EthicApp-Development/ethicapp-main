// Integration tests for the PDF render job statements (#877), against a real
// PostgreSQL database with migrations V1-V32 applied: a job flagged while a
// worker renders it (the management console erased the case's author email)
// is queued again when the worker completes it, even when the flag is
// committed while the completion waits for the row.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert users, cases and jobs of their
// own; claims take the oldest due job, so each test makes its job the oldest.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import pg from "pg";

import {
    CLAIM_NEXT_JOB_SQL,
    MARK_JOB_COMPLETED_SQL,
    RERENDER_REQUESTED_KEY,
} from "../pdf-render-job-statements.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

// What the console sets on a job a worker is processing
// (RERENDER_ERASED_AUTHOR_EMAIL_SQL in management-console/backend/helpers/teacher-materials-helper.js).
const FLAG_SQL = `
    UPDATE pdf_render_jobs
    SET metadata = metadata || '{"reason": "author_email_erased", "${RERENDER_REQUESTED_KEY}": true}'::jsonb
    WHERE id = $1 AND status = 'processing'
`;

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
    return pool;
}

async function query(sql, params = []) {
    return (await getPool().query(sql, params)).rows;
}

test.after(async () => {
    await pool?.end();
});

// A case with a job a worker is processing: claimed once.
async function insertProcessingJob() {
    const suffix = randomUUID();
    const [user] = await query(
        "INSERT INTO users (name, rut, mail, role) VALUES ('Render teacher', $1, $2, 'P') RETURNING id;",
        [suffix, `${suffix}@integration.test`]
    );
    const [caseRow] = await query(`
        INSERT INTO ethical_cases (title, author_firstname, author_lastname, author_email, pdf_path, creator)
        VALUES ($1, 'Tom', 'Teacher', $2, 'pending', $3)
        RETURNING id;
    `, [`Case ${suffix}`, `${suffix}@integration.test`, user.id]);
    const [job] = await query(`
        INSERT INTO pdf_render_jobs (owner_type, owner_id, source_path, status, started_at, attempt_count, requested_at)
        VALUES ('case', $1, $2, 'processing', now(), 1, '2000-01-01T00:00:00Z')
        RETURNING id;
    `, [caseRow.id, `/uploads/cases/${caseRow.id}/case.pdf`]);
    return Number(job.id);
}

async function jobState(jobId) {
    const [row] = await query(
        "SELECT status, attempt_count, started_at, completed_at, page_count, metadata FROM pdf_render_jobs WHERE id = $1;",
        [jobId]
    );
    return row;
}

function complete(jobId, client = getPool()) {
    return client.query(MARK_JOB_COMPLETED_SQL, [
        jobId, 3, `/uploads/cases/${jobId}/representation.json`, JSON.stringify({ renderer: { pageCount: 3 } }),
    ]);
}

async function waitUntilBlockedOnLock(pid) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const [row] = await query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1;", [pid]);
        if (row?.wait_event_type === "Lock") {
            return;
        }
        await delay(50);
    }
    throw new Error(`Backend ${pid} never waited on a lock.`);
}

test("a job completes as usual when nothing flagged it", { skip: SKIP_REASON }, async () => {
    const jobId = await insertProcessingJob();

    const { rows } = await complete(jobId);

    assert.deepEqual(rows, [{ status: "completed" }]);
    const job = await jobState(jobId);
    assert.equal(job.status, "completed");
    assert.ok(job.completed_at);
    assert.equal(job.page_count, 3);
});

test("a job flagged while it renders is queued again on completion, and the next render completes it", {
    skip: SKIP_REASON,
}, async () => {
    const jobId = await insertProcessingJob();
    await query(FLAG_SQL, [jobId]);

    assert.deepEqual((await complete(jobId)).rows, [{ status: "pending" }]);
    let job = await jobState(jobId);
    assert.equal(job.status, "pending");
    assert.equal(job.attempt_count, 0);
    assert.equal(job.started_at, null);
    assert.equal(job.completed_at, null);
    assert.equal(job.metadata[RERENDER_REQUESTED_KEY], undefined);
    assert.equal(job.metadata.reason, "author_email_erased");

    // The next claim takes it, and that render, which reads the case after
    // the change, completes it.
    const [claimed] = (await getPool().query(CLAIM_NEXT_JOB_SQL)).rows;
    assert.equal(Number(claimed.id), jobId);
    assert.equal(claimed.status, "processing");
    assert.deepEqual((await complete(jobId)).rows, [{ status: "completed" }]);
    job = await jobState(jobId);
    assert.equal(job.status, "completed");
});

test("a flag committed while the completion waits for the row still queues the job again", {
    skip: SKIP_REASON,
}, async () => {
    const jobId = await insertProcessingJob();

    // The console's forgetting transaction flags the job and has not
    // committed yet when the worker finishes.
    const forgetting = await getPool().connect();
    await forgetting.query("BEGIN");
    await forgetting.query(FLAG_SQL, [jobId]);

    const worker = await getPool().connect();
    const [{ pid }] = (await worker.query("SELECT pg_backend_pid() AS pid;")).rows;
    const completion = complete(jobId, worker).finally(() => worker.release());
    await waitUntilBlockedOnLock(pid);

    await forgetting.query("COMMIT");
    forgetting.release();

    assert.deepEqual((await completion).rows, [{ status: "pending" }]);
    assert.equal((await jobState(jobId)).status, "pending");
    // Due and the oldest: the next test's claim would take it.
    await query("DELETE FROM pdf_render_jobs WHERE id = $1;", [jobId]);
});

test("claiming a job clears a flag left by a render that failed", { skip: SKIP_REASON }, async () => {
    const jobId = await insertProcessingJob();
    await query(FLAG_SQL, [jobId]);
    // The render failed with attempts left: pending again, flag kept.
    await query("UPDATE pdf_render_jobs SET status = 'pending', started_at = NULL WHERE id = $1;", [jobId]);

    const [claimed] = (await getPool().query(CLAIM_NEXT_JOB_SQL)).rows;

    assert.equal(Number(claimed.id), jobId);
    assert.equal(claimed.metadata[RERENDER_REQUESTED_KEY], undefined);
    assert.deepEqual((await complete(jobId)).rows, [{ status: "completed" }]);
});

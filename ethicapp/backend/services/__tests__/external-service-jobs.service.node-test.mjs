import assert from "node:assert/strict";
import test from "node:test";
import {
    ExternalServiceJobsService,
    JOB_STATUS,
    RESULT_STATUS,
} from "../external-service-jobs.service.js";

const JOB_UUID    = "a1b2c3d4-0000-4000-8000-000000000001";
const RESULT_UUID = "a1b2c3d4-0000-4000-8000-000000000002";

// Returns a fake dbQuery that serves responses in call order and records calls.
function makeDbQueue(...responses) {
    const calls = [];
    let   index = 0;
    async function db(sql, params) {
        calls.push({ sql, params });
        const r = responses[index++];
        return Array.isArray(r) ? r : [];
    }
    db.calls = calls;
    return db;
}

// ─── createJob ───────────────────────────────────────────────────────────────

test("createJob: inserts with pending status and returns first row", async () => {
    const expected = {
        id:         JOB_UUID,
        service_id: "polyadic-devils-advocate",
        hook_name:  "chat-message-received",
        status:     JOB_STATUS.PENDING,
    };
    const db  = makeDbQueue([expected]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const result = await svc.createJob({
        serviceId: "polyadic-devils-advocate",
        hookName:  "chat-message-received",
        sessionId: 10,
        phaseId:   20,
    });

    assert.equal(result.id, JOB_UUID);
    assert.equal(result.status, JOB_STATUS.PENDING);

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("INSERT INTO external_service_jobs"));
    assert.equal(params[0], "polyadic-devils-advocate");
    assert.equal(params[1], "chat-message-received");
    assert.equal(params[2], JOB_STATUS.PENDING);
    assert.equal(params[3], 10);
    assert.equal(params[4], 20);
});

test("createJob: returns null when db returns empty rows", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const result = await svc.createJob({ serviceId: "svc", hookName: "hook" });
    assert.equal(result, null);
});

// ─── updateJobStatus ──────────────────────────────────────────────────────────

test("updateJobStatus: dispatched — includes dispatched_at param", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const ts = new Date().toISOString();
    await svc.updateJobStatus(JOB_UUID, JOB_STATUS.DISPATCHED, { dispatchedAt: ts });

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("UPDATE external_service_jobs"));
    assert.ok(sql.includes("dispatched_at"));
    assert.equal(params[0], JOB_UUID);
    assert.equal(params[1], JOB_STATUS.DISPATCHED);
    assert.equal(params[2], ts);
});

test("updateJobStatus: completed — includes completed_at param", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const ts = new Date().toISOString();
    await svc.updateJobStatus(JOB_UUID, JOB_STATUS.COMPLETED, { completedAt: ts });

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("completed_at"));
    assert.equal(params[2], ts);
});

test("updateJobStatus: no optional timestamps — sql omits timestamp columns", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.updateJobStatus(JOB_UUID, JOB_STATUS.FAILED);

    const { sql, params } = db.calls[0];
    assert.ok(!sql.includes("dispatched_at"));
    assert.ok(!sql.includes("completed_at"));
    assert.equal(params.length, 2);
});

// ─── recordProviderReference ─────────────────────────────────────────────────

test("recordProviderReference: sets provider_reference on job", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.recordProviderReference(JOB_UUID, "provider-job-42");

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("provider_reference"));
    assert.equal(params[0], JOB_UUID);
    assert.equal(params[1], "provider-job-42");
});

// ─── createResult ─────────────────────────────────────────────────────────────

test("createResult: matching correlationId — resolves job, updates job status", async () => {
    const jobRow    = {
        id:          JOB_UUID,
        session_id:  null,
        phase_id:    null,
        question_id: null,
        group_id:    null,
        user_id:     null,
    };
    const resultRow = {
        id:             RESULT_UUID,
        job_id:         JOB_UUID,
        correlation_id: JOB_UUID,
        status:         RESULT_STATUS.CALLBACK_RECEIVED,
    };
    // call 0: job lookup; call 1: insert result; call 2: update job status
    const db  = makeDbQueue([jobRow], [resultRow], []);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const result = await svc.createResult({
        correlationId: JOB_UUID,
        serviceId:     "polyadic-devils-advocate",
        rawPayload:    { room: "r1", evaluations: [] },
    });

    assert.equal(result.status, RESULT_STATUS.CALLBACK_RECEIVED);
    assert.equal(result.job_id, JOB_UUID);
    assert.equal(db.calls.length, 3);

    // call 0: SELECT includes service_id guard
    assert.ok(db.calls[0].sql.includes("service_id = $2"));
    assert.equal(db.calls[0].params[0], JOB_UUID);
    assert.equal(db.calls[0].params[1], "polyadic-devils-advocate");

    // call 1: INSERT result with callback-received status
    assert.ok(db.calls[1].sql.includes("INSERT INTO external_service_results"));
    assert.equal(db.calls[1].params[4], RESULT_STATUS.CALLBACK_RECEIVED);

    // call 2: UPDATE job to callback-received
    assert.ok(db.calls[2].sql.includes("UPDATE external_service_jobs"));
    assert.equal(db.calls[2].params[1], JOB_STATUS.CALLBACK_RECEIVED);
});

test("createResult: propagates job context to result when caller omits it", async () => {
    const jobRow    = {
        id:          JOB_UUID,
        session_id:  10,
        phase_id:    20,
        question_id: 30,
        group_id:    40,
        user_id:     99,
    };
    const resultRow = {
        id:     RESULT_UUID,
        job_id: JOB_UUID,
        status: RESULT_STATUS.CALLBACK_RECEIVED,
    };
    const db  = makeDbQueue([jobRow], [resultRow], []);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.createResult({
        correlationId: JOB_UUID,
        serviceId:     "polyadic-devils-advocate",
        rawPayload:    {},
    });

    // INSERT params: $6=sessionId, $7=phaseId, $8=questionId, $9=groupId, $10=userId
    const insertParams = db.calls[1].params;
    assert.equal(insertParams[5],  10);
    assert.equal(insertParams[6],  20);
    assert.equal(insertParams[7],  30);
    assert.equal(insertParams[8],  40);
    assert.equal(insertParams[9],  99);
});

test("createResult: caller-provided context takes precedence over job context", async () => {
    const jobRow    = {
        id:          JOB_UUID,
        session_id:  10,
        phase_id:    20,
        question_id: null,
        group_id:    null,
        user_id:     null,
    };
    const resultRow = {
        id:     RESULT_UUID,
        job_id: JOB_UUID,
        status: RESULT_STATUS.CALLBACK_RECEIVED,
    };
    const db  = makeDbQueue([jobRow], [resultRow], []);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.createResult({
        correlationId: JOB_UUID,
        serviceId:     "polyadic-devils-advocate",
        rawPayload:    {},
        sessionId:     99,
    });

    // Caller passed sessionId=99; job has session_id=10. Caller wins.
    assert.equal(db.calls[1].params[5], 99);
    // phaseId not passed by caller; falls back to job's phase_id=20.
    assert.equal(db.calls[1].params[6], 20);
});

test("createResult: cross-service correlationId — unknown-correlation, no job update", async () => {
    // Job lookup returns empty when service_id doesn't match, even if UUID exists elsewhere.
    const resultRow = { id: RESULT_UUID, job_id: null, status: RESULT_STATUS.UNKNOWN_CORRELATION };
    const db  = makeDbQueue([], [resultRow]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const result = await svc.createResult({
        correlationId: JOB_UUID,
        serviceId:     "argumentation-tutor-system",
        rawPayload:    {},
    });

    assert.equal(result.status, RESULT_STATUS.UNKNOWN_CORRELATION);
    assert.equal(db.calls.length, 2);
    assert.equal(db.calls[0].params[1], "argumentation-tutor-system");
});

test("createResult: unknown correlationId — unknown-correlation, no job update", async () => {
    const resultRow = {
        id:             RESULT_UUID,
        job_id:         null,
        correlation_id: "unknown-id",
        status:         RESULT_STATUS.UNKNOWN_CORRELATION,
    };
    // call 0: job lookup returns nothing; call 1: insert result
    const db  = makeDbQueue([], [resultRow]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const result = await svc.createResult({
        correlationId: "unknown-id",
        serviceId:     "polyadic-devils-advocate",
        rawPayload:    { data: 1 },
    });

    assert.equal(result.status, RESULT_STATUS.UNKNOWN_CORRELATION);
    assert.equal(result.job_id, null);
    assert.equal(db.calls.length, 2);
    assert.equal(db.calls[1].params[4], RESULT_STATUS.UNKNOWN_CORRELATION);
});

test("createResult: null correlationId — skips job lookup, unknown-correlation", async () => {
    const resultRow = {
        id:     RESULT_UUID,
        job_id: null,
        status: RESULT_STATUS.UNKNOWN_CORRELATION,
    };
    const db  = makeDbQueue([resultRow]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.createResult({
        correlationId: null,
        serviceId:     "argumentation-tutor-system",
        rawPayload:    {},
    });

    // Only the INSERT call; no SELECT because correlationId is null
    assert.equal(db.calls.length, 1);
    assert.ok(db.calls[0].sql.includes("INSERT INTO external_service_results"));
});

test("createResult: duplicate — terminal job is not overwritten to callback-received", async () => {
    const jobRow    = {
        id:          JOB_UUID,
        status:      JOB_STATUS.COMPLETED,
        session_id:  null,
        phase_id:    null,
        question_id: null,
        group_id:    null,
        user_id:     null,
    };
    const resultRow = { id: RESULT_UUID, job_id: JOB_UUID, status: RESULT_STATUS.CALLBACK_RECEIVED };
    // Only 2 calls expected: SELECT + INSERT; no UPDATE because job is terminal.
    const db  = makeDbQueue([jobRow], [resultRow]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const result = await svc.createResult({
        correlationId: JOB_UUID,
        serviceId:     "polyadic-devils-advocate",
        rawPayload:    {},
    });

    assert.equal(db.calls.length, 2, "should not UPDATE when job is already terminal");
    assert.equal(result.is_duplicate,     true);
    assert.equal(result.job_prior_status, JOB_STATUS.COMPLETED);
});

test("createResult: non-terminal job sets is_duplicate to false", async () => {
    const jobRow    = {
        id:          JOB_UUID,
        status:      JOB_STATUS.DISPATCHED,
        session_id:  null,
        phase_id:    null,
        question_id: null,
        group_id:    null,
        user_id:     null,
    };
    const resultRow = { id: RESULT_UUID, job_id: JOB_UUID, status: RESULT_STATUS.CALLBACK_RECEIVED };
    const db  = makeDbQueue([jobRow], [resultRow], []);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const result = await svc.createResult({
        correlationId: JOB_UUID,
        serviceId:     "polyadic-devils-advocate",
        rawPayload:    {},
    });

    assert.equal(db.calls.length, 3, "should UPDATE non-terminal job");
    assert.equal(result.is_duplicate,     false);
    assert.equal(result.job_prior_status, JOB_STATUS.DISPATCHED);
});

// ─── updateResult ─────────────────────────────────────────────────────────────

test("updateResult: sets status, sanitizedPayload, and adapterResult", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const sanitized = { summary: "Good argument." };
    const outcome   = { published: true };
    await svc.updateResult(RESULT_UUID, {
        status:           RESULT_STATUS.COMPLETED,
        sanitizedPayload: sanitized,
        adapterResult:    outcome,
    });

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("UPDATE external_service_results"));
    assert.ok(sql.includes("sanitized_payload"));
    assert.ok(sql.includes("adapter_result"));
    assert.equal(params[0], RESULT_UUID);
    assert.equal(params[1], RESULT_STATUS.COMPLETED);
    assert.deepEqual(params[2], sanitized);
    assert.deepEqual(params[3], outcome);
});

test("updateResult: omits sanitizedPayload and adapterResult when not provided", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.updateResult(RESULT_UUID, { status: RESULT_STATUS.FAILED });

    const { sql, params } = db.calls[0];
    assert.ok(!sql.includes("sanitized_payload"));
    assert.ok(!sql.includes("adapter_result"));
    assert.equal(params.length, 2);
});

// ─── queryRecentJobs ──────────────────────────────────────────────────────────

test("queryRecentJobs: no filters — no WHERE clause, limit 50", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.queryRecentJobs();

    const { sql, params } = db.calls[0];
    assert.ok(!sql.includes("WHERE"));
    assert.equal(params[0], 50);
});

test("queryRecentJobs: serviceId and status filters — WHERE clause present", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.queryRecentJobs({ serviceId: "polyadic-devils-advocate", status: "pending" });

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("WHERE"));
    assert.ok(sql.includes("service_id"));
    assert.ok(sql.includes("status"));
    assert.equal(params[0], "polyadic-devils-advocate");
    assert.equal(params[1], "pending");
});

test("queryRecentJobs: caps limit at 200", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.queryRecentJobs({ limit: 9999 });

    const { params } = db.calls[0];
    assert.equal(params[params.length - 1], 200);
});

// ─── queryRecentResults ───────────────────────────────────────────────────────

test("queryRecentResults: sessionId filter — WHERE clause present", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.queryRecentResults({ sessionId: 42 });

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("WHERE"));
    assert.ok(sql.includes("session_id"));
    assert.equal(params[0], 42);
});

test("queryRecentResults: no filters — no WHERE clause, default limit 50", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.queryRecentResults();

    const { sql, params } = db.calls[0];
    assert.ok(!sql.includes("WHERE"));
    assert.equal(params[0], 50);
});

// ─── getJob ───────────────────────────────────────────────────────────────────

test("getJob: returns the job row when found", async () => {
    const expected = { id: JOB_UUID, service_id: "svc-a", hook_name: "phase-started", status: "completed" };
    const db  = makeDbQueue([expected]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const result = await svc.getJob(JOB_UUID);

    assert.equal(result.id, JOB_UUID);
    assert.equal(result.status, "completed");

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("external_service_jobs"));
    assert.equal(params[0], JOB_UUID);
});

test("getJob: returns null when job does not exist", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const result = await svc.getJob("aaaaaaaa-0000-0000-0000-000000000000");

    assert.equal(result, null);
});

// ─── getJobResults ────────────────────────────────────────────────────────────

test("getJobResults: returns results for the given job ordered by received_at", async () => {
    const row = { id: RESULT_UUID, job_id: JOB_UUID, status: "completed", adapter_result: null };
    const db  = makeDbQueue([row]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const results = await svc.getJobResults(JOB_UUID);

    assert.equal(results.length, 1);
    assert.equal(results[0].id, RESULT_UUID);

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("external_service_results"));
    assert.ok(sql.includes("job_id = $1"));
    assert.ok(sql.includes("ORDER BY received_at ASC"));
    assert.equal(params[0], JOB_UUID);
});

test("getJobResults: does not select raw_payload", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.getJobResults(JOB_UUID);

    const { sql } = db.calls[0];
    assert.ok(!sql.includes("raw_payload"));
});

test("getJobResults: returns empty array when job has no results", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    const results = await svc.getJobResults(JOB_UUID);

    assert.deepEqual(results, []);
});

// ─── queryRecentJobs date range ───────────────────────────────────────────────

test("queryRecentJobs: from and to filters — added to WHERE and params", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.queryRecentJobs({ from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" });

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("created_at >="));
    assert.ok(sql.includes("created_at <="));
    assert.ok(params.includes("2026-01-01T00:00:00Z"));
    assert.ok(params.includes("2026-06-01T00:00:00Z"));
});

// ─── queryRecentResults additional filters ────────────────────────────────────

test("queryRecentResults: phaseId filter — WHERE clause present", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.queryRecentResults({ phaseId: 7 });

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("phase_id"));
    assert.equal(params[0], 7);
});

test("queryRecentResults: from and to filters — added to WHERE and params", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.queryRecentResults({ from: "2026-01-01T00:00:00Z", to: "2026-06-01T00:00:00Z" });

    const { sql, params } = db.calls[0];
    assert.ok(sql.includes("received_at >="));
    assert.ok(sql.includes("received_at <="));
    assert.ok(params.includes("2026-01-01T00:00:00Z"));
    assert.ok(params.includes("2026-06-01T00:00:00Z"));
});

test("queryRecentResults: does not select raw_payload or sanitized_payload", async () => {
    const db  = makeDbQueue([]);
    const svc = new ExternalServiceJobsService({ dbQuery: db });

    await svc.queryRecentResults();

    const { sql } = db.calls[0];
    assert.ok(!sql.includes("raw_payload"));
    assert.ok(!sql.includes("sanitized_payload"));
});

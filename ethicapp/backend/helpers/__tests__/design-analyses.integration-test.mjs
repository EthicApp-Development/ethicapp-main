// Integration tests for design analyses (#847), against a real PostgreSQL
// database with migrations V1-V25 applied: the reservation upsert, its
// in-flight and stale conditions, the conditional completion and failure, and
// the cascade on design deletion cannot be checked with fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import {
    completeDesignAnalysis,
    failDesignAnalysis,
    getDesignAnalysis,
    listDesignAnalyses,
    markDesignAnalysisProcessing,
    releaseUnstartedDesignAnalysis,
    reserveDesignAnalysisGeneration,
    saveReviewedDesignAnalysis,
} from "../design-analyses-helper.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
    return pool;
}

const dbQuery = async (sql, params = []) => (await getPool().query(sql, params)).rows;

// The helpers' query signature, over the integration pool.
const query = ({ sql, sqlParams }) => dbQuery(sql, sqlParams);

test.after(async () => {
    await pool?.end();
});

async function createDesign() {
    const suffix = randomUUID();
    const [user] = await dbQuery(`
        INSERT INTO users (name, rut, mail, role)
        VALUES ('Integration teacher', $1, $2, 'P')
        RETURNING id;
    `, [suffix, `${suffix}@integration.test`]);
    const [design] = await dbQuery(`
        INSERT INTO designs (creator, design)
        VALUES ($1, '{}'::jsonb)
        RETURNING id;
    `, [user.id]);
    return { userId: user.id, designId: design.id, serviceId: `svc-design-${suffix}` };
}

// Ages a row past the 15-minute stale window.
async function makeStale({ designId, serviceId }) {
    await dbQuery(`
        UPDATE design_analyses
        SET updated_at = now() - interval '16 minutes'
        WHERE design_id = $1
          AND service_id = $2;
    `, [designId, serviceId]);
}

// Runs one generation to completion and returns its job id.
async function generate(ids, { inputHash, document }) {
    const reservation = await reserveDesignAnalysisGeneration({ ...ids, inputHash }, query);
    assert.ok(reservation, "the generation is reserved");
    const jobId = reservation.job_id;
    assert.ok(await markDesignAnalysisProcessing({ ...ids, jobId }, query));
    assert.ok(await completeDesignAnalysis({
        serviceId:      ids.serviceId,
        jobId,
        documentSchema: "claim-typology/v1",
        document,
    }, query));
    return jobId;
}

test("design analyses: the first reservation creates the row; a second one is refused while in flight", { skip: SKIP_REASON }, async () => {
    const { userId, designId, serviceId } = await createDesign();

    const reservation = await reserveDesignAnalysisGeneration(
        { designId, serviceId, inputHash: "hash-1", userId },
        query
    );
    assert.equal(reservation.status, "requested");
    assert.equal(reservation.input_hash, "hash-1");
    assert.equal(reservation.is_stale, false);
    assert.match(reservation.job_id, /^[0-9a-f-]{36}$/u);

    assert.equal(
        await reserveDesignAnalysisGeneration({ designId, serviceId, inputHash: "hash-2" }, query),
        null,
        "requested is in flight"
    );

    await markDesignAnalysisProcessing({ designId, serviceId, jobId: reservation.job_id }, query);
    assert.equal(
        await reserveDesignAnalysisGeneration({ designId, serviceId, inputHash: "hash-2" }, query),
        null,
        "processing is in flight"
    );

    const rows = await listDesignAnalyses(designId, query);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "processing");
    assert.equal(rows[0].input_hash, "hash-1");
});

test("design analyses: a stale generation can be replaced and can no longer store its result", { skip: SKIP_REASON }, async () => {
    const { designId, serviceId } = await createDesign();
    const ids = { designId, serviceId };

    const first = await reserveDesignAnalysisGeneration({ ...ids, inputHash: "hash-1" }, query);
    await markDesignAnalysisProcessing({ ...ids, jobId: first.job_id }, query);
    await makeStale(ids);

    assert.equal((await listDesignAnalyses(designId, query))[0].is_stale, true);

    const second = await reserveDesignAnalysisGeneration({ ...ids, inputHash: "hash-2" }, query);
    assert.ok(second, "a stale generation does not block a new one");
    assert.notEqual(second.job_id, first.job_id);
    assert.equal(second.input_hash, "hash-2");

    assert.equal(await completeDesignAnalysis({
        serviceId, jobId: first.job_id, documentSchema: "claim-typology/v1", document: { late: true },
    }, query), null, "the superseded job stores nothing");
    assert.equal(await failDesignAnalysis({ serviceId, jobId: first.job_id, errorCode: "late" }, query), null);
    assert.equal(
        await markDesignAnalysisProcessing({ ...ids, jobId: first.job_id }, query),
        null
    );

    const row = await getDesignAnalysis(ids, query);
    assert.equal(row.status, "requested");
    assert.equal(row.document, null);
    assert.equal(row.job_id, second.job_id);
});

test("design analyses: completion and failure apply only to the processing job", { skip: SKIP_REASON }, async () => {
    const { designId, serviceId } = await createDesign();
    const ids = { designId, serviceId };

    const reservation = await reserveDesignAnalysisGeneration({ ...ids, inputHash: "hash-1" }, query);
    const jobId = reservation.job_id;

    assert.equal(await completeDesignAnalysis({
        serviceId, jobId, documentSchema: "claim-typology/v1", document: { early: true },
    }, query), null, "a generation that was not started cannot complete");

    await markDesignAnalysisProcessing({ ...ids, jobId }, query);
    assert.equal(await failDesignAnalysis({
        serviceId: "another-service", jobId, errorCode: "x",
    }, query), null, "another service cannot fail it");

    const failed = await failDesignAnalysis({
        serviceId, jobId, errorCode: "timeout", errorMessage: "No answer.",
    }, query);
    assert.equal(failed.status, "failed", "no document, so the analysis failed");
    assert.equal(failed.error_code, "timeout");
    assert.equal(await failDesignAnalysis({ serviceId, jobId, errorCode: "again" }, query), null);
});

test("design analyses: a new generation keeps the previous document until it replaces it", { skip: SKIP_REASON }, async () => {
    const { designId, serviceId, userId } = await createDesign();
    const ids = { designId, serviceId };

    await generate(ids, { inputHash: "hash-1", document: { version: 1 } });
    let row = await getDesignAnalysis(ids, query);
    assert.equal(row.status, "ready");
    assert.deepEqual(row.document, { version: 1 });
    assert.ok(row.generated_at);

    // A failed regeneration keeps the document.
    const failedRun = await reserveDesignAnalysisGeneration({ ...ids, inputHash: "hash-2" }, query);
    row = await getDesignAnalysis(ids, query);
    assert.equal(row.status, "requested");
    assert.deepEqual(row.document, { version: 1 }, "readable while being regenerated");
    await markDesignAnalysisProcessing({ ...ids, jobId: failedRun.job_id }, query);
    await failDesignAnalysis({ serviceId, jobId: failedRun.job_id, errorCode: "timeout" }, query);
    row = await getDesignAnalysis(ids, query);
    assert.equal(row.status, "ready");
    assert.deepEqual(row.document, { version: 1 });
    assert.equal(row.error_code, "timeout");

    // An unstarted reservation is released the same way.
    const unstarted = await reserveDesignAnalysisGeneration({ ...ids, inputHash: "hash-2" }, query);
    const released = await releaseUnstartedDesignAnalysis({ ...ids, jobId: unstarted.job_id }, query);
    assert.equal(released.status, "ready");
    assert.equal(released.error_code, "generation-not-started");

    // A teacher edit (with a validator) is replaced by the next generation.
    assert.ok(await saveReviewedDesignAnalysis({
        ...ids, documentSchema: "claim-typology/v1", document: { edited: true }, userId,
    }, query));
    assert.ok((await getDesignAnalysis(ids, query)).reviewed_at);

    await generate(ids, { inputHash: "hash-3", document: { version: 2 } });
    row = await getDesignAnalysis(ids, query);
    assert.equal(row.status, "ready");
    assert.deepEqual(row.document, { version: 2 });
    assert.equal(row.input_hash, "hash-3");
    assert.equal(row.error_code, null);
    assert.equal(row.reviewed_at, null);
    assert.equal(row.reviewed_by, null);
    assert.equal((await listDesignAnalyses(designId, query)).length, 1, "one row per service");
});

test("design analyses: deleting the design deletes its analyses", { skip: SKIP_REASON }, async () => {
    const { designId, serviceId } = await createDesign();
    await generate({ designId, serviceId }, { inputHash: "hash-1", document: { version: 1 } });

    await dbQuery("DELETE FROM designs WHERE id = $1;", [designId]);

    assert.deepEqual(
        await dbQuery("SELECT 1 FROM design_analyses WHERE design_id = $1;", [designId]),
        []
    );
});

test("design analyses: of concurrent reservations exactly one is accepted", { skip: SKIP_REASON }, async () => {
    const { designId, serviceId } = await createDesign();

    const results = await Promise.all(Array.from({ length: 5 }, (_, index) =>
        reserveDesignAnalysisGeneration({ designId, serviceId, inputHash: `hash-${index}` }, query)
    ));

    assert.equal(results.filter(Boolean).length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import { generationInFlight } from "../analyses-store-helper.js";
import {
    completeDesignAnalysis,
    failDesignAnalysis,
    getDesignAnalysis,
    listDesignAnalyses,
    markDesignAnalysisProcessing,
    releaseUnstartedDesignAnalysis,
    reserveDesignAnalysisGeneration,
    saveReviewedDesignAnalysis,
    STALE_GENERATION_INTERVAL,
} from "../design-analyses-helper.js";

// The SQL of these helpers runs against PostgreSQL in
// design-analyses.integration-test.mjs; these tests pin the conditions that
// keep generations consistent.

const JOB_ID   = "b2c3d4e5-0000-4000-8000-000000000051";
const DOCUMENT = { typologies: [{ phaseId: 0, questionId: 0 }] };

// Adapter results only apply to the processing row of the job that produced them.
const CURRENT_JOB_CONDITION =
    "WHERE service_id = $1 AND job_id = $2::uuid AND status = 'processing'";

// Records each query and answers it with the given rows.
function makeQuery(rows = []) {
    const calls = [];
    const query = async ({ sql, sqlParams }) => {
        calls.push({ sql: sql.replace(/\s+/g, " ").trim(), sqlParams });
        return rows;
    };
    return { query, calls };
}

// ─── shared condition ────────────────────────────────────────────────────────

test("generationInFlight: requested or processing within the stale window", () => {
    const normalize = sql => sql.replace(/\s+/g, " ").trim();

    assert.equal(
        normalize(generationInFlight()),
        "(status IN ('requested', 'processing') "
            + `AND updated_at >= now() - interval '${STALE_GENERATION_INTERVAL}')`
    );
    assert.equal(
        normalize(generationInFlight("da")),
        "(da.status IN ('requested', 'processing') "
            + `AND da.updated_at >= now() - interval '${STALE_GENERATION_INTERVAL}')`
    );
    assert.equal(STALE_GENERATION_INTERVAL, "15 minutes");
});

// ─── reads ───────────────────────────────────────────────────────────────────

test("listDesignAnalyses: selects the analyses of a design without their documents", async () => {
    const { query, calls } = makeQuery([{ service_id: "svc-a" }]);

    const rows = await listDesignAnalyses(5, query);

    assert.deepEqual(rows, [{ service_id: "svc-a" }]);
    assert.deepEqual(calls[0].sqlParams, [5]);
    assert.match(calls[0].sql, /FROM design_analyses WHERE design_id = \$1/);
    assert.match(calls[0].sql, /input_hash, error_code/);
    assert.match(calls[0].sql, /AS is_stale/);
    assert.doesNotMatch(calls[0].sql, /\bdocument,/);
});

test("getDesignAnalysis: selects one analysis with its document, or null", async () => {
    const found = makeQuery([{ service_id: "svc-a" }]);
    const missing = makeQuery([]);

    assert.deepEqual(
        await getDesignAnalysis({ designId: 5, serviceId: "svc-a" }, found.query),
        { service_id: "svc-a" }
    );
    assert.equal(await getDesignAnalysis({ designId: 5, serviceId: "svc-x" }, missing.query), null);
    assert.deepEqual(found.calls[0].sqlParams, [5, "svc-a"]);
    assert.match(found.calls[0].sql, /\bdocument,/);
    assert.match(found.calls[0].sql, /WHERE design_id = \$1 AND service_id = \$2/);
});

// ─── reservation ─────────────────────────────────────────────────────────────

test("reserveDesignAnalysisGeneration: creates or re-reserves the row in one statement", async () => {
    const { query, calls } = makeQuery([{ status: "requested", job_id: JOB_ID }]);

    const row = await reserveDesignAnalysisGeneration(
        { designId: 5, serviceId: "svc-a", inputHash: "sha256:abc", userId: 3 },
        query
    );

    assert.deepEqual(row, { status: "requested", job_id: JOB_ID });
    assert.equal(calls.length, 1, "the check and the reservation are the same statement");
    assert.deepEqual(calls[0].sqlParams, [5, "svc-a", "sha256:abc", 3]);
    assert.ok(calls[0].sql.includes(
        "INSERT INTO design_analyses AS da (design_id, service_id, job_id, input_hash, requested_by) "
            + "VALUES ($1, $2, gen_random_uuid(), $3, $4) "
            + "ON CONFLICT (design_id, service_id) DO UPDATE"
    ));
    assert.match(calls[0].sql, /SET status = 'requested', job_id = EXCLUDED\.job_id, input_hash = EXCLUDED\.input_hash/);
    assert.ok(calls[0].sql.includes(`WHERE NOT ${generationInFlight("da").replace(/\s+/g, " ")} RETURNING`));
    assert.match(calls[0].sql, /AS is_stale\s*,\s*job_id\s*;$/);
    assert.doesNotMatch(calls[0].sql, /document =/, "the previous document is kept");
});

test("reserveDesignAnalysisGeneration: without a hash or user both are NULL", async () => {
    const { query, calls } = makeQuery([{ status: "requested" }]);

    await reserveDesignAnalysisGeneration({ designId: 5, serviceId: "svc-a" }, query);

    assert.deepEqual(calls[0].sqlParams, [5, "svc-a", null, null]);
});

test("reserveDesignAnalysisGeneration: null while a generation is in flight", async () => {
    const { query } = makeQuery([]);

    assert.equal(
        await reserveDesignAnalysisGeneration({ designId: 5, serviceId: "svc-a" }, query),
        null
    );
});

// ─── adapter updates ─────────────────────────────────────────────────────────

test("markDesignAnalysisProcessing: starts only the reserved job", async () => {
    const { query, calls } = makeQuery([{ status: "processing" }]);

    const row = await markDesignAnalysisProcessing(
        { designId: 5, serviceId: "svc-a", jobId: JOB_ID },
        query
    );

    assert.deepEqual(row, { status: "processing" });
    assert.deepEqual(calls[0].sqlParams, [5, "svc-a", JOB_ID]);
    assert.ok(calls[0].sql.includes("UPDATE design_analyses SET status = 'processing'"));
    assert.ok(calls[0].sql.includes(
        "WHERE design_id = $1 AND service_id = $2 AND job_id = $3::uuid AND status = 'requested'"
    ));
});

test("releaseUnstartedDesignAnalysis: ends a reservation its job never started", async () => {
    const { query, calls } = makeQuery([{ status: "failed" }]);

    await releaseUnstartedDesignAnalysis({ designId: 5, serviceId: "svc-a", jobId: JOB_ID }, query);

    assert.deepEqual(calls[0].sqlParams, [
        5,
        "svc-a",
        JOB_ID,
        "generation-not-started",
        "The analysis service did not start the generation.",
    ]);
    assert.match(calls[0].sql, /CASE WHEN document IS NULL THEN 'failed' ELSE 'ready' END/);
    assert.ok(calls[0].sql.includes(
        "WHERE design_id = $1 AND service_id = $2 AND job_id = $3::uuid AND status = 'requested'"
    ));
});

test("completeDesignAnalysis: replaces the document only for the current job", async () => {
    const { query, calls } = makeQuery([]);

    const row = await completeDesignAnalysis(
        { serviceId: "svc-a", jobId: JOB_ID, documentSchema: "claim-typology/v1", document: DOCUMENT },
        query
    );

    assert.equal(row, null, "a superseded job updates no row");
    assert.deepEqual(calls[0].sqlParams, [
        "svc-a", JOB_ID, "claim-typology/v1", JSON.stringify(DOCUMENT),
    ]);
    assert.ok(calls[0].sql.includes("UPDATE design_analyses SET status = 'ready'"));
    assert.ok(calls[0].sql.includes(CURRENT_JOB_CONDITION));
    assert.match(calls[0].sql, /document = \$4::jsonb/);
    assert.match(calls[0].sql, /reviewed_at = NULL, reviewed_by = NULL/);
});

test("failDesignAnalysis: keeps any document, only for the current job", async () => {
    const { query, calls } = makeQuery([{ status: "ready" }]);

    await failDesignAnalysis(
        { serviceId: "svc-a", jobId: JOB_ID, errorCode: "timeout", errorMessage: "No answer." },
        query
    );

    assert.deepEqual(calls[0].sqlParams, ["svc-a", JOB_ID, "timeout", "No answer."]);
    assert.ok(calls[0].sql.includes("UPDATE design_analyses"));
    assert.match(calls[0].sql, /CASE WHEN document IS NULL THEN 'failed' ELSE 'ready' END/);
    assert.ok(calls[0].sql.includes(CURRENT_JOB_CONDITION));
    assert.doesNotMatch(calls[0].sql, /document =/);
});

test("saveReviewedDesignAnalysis: refused during a generation, drops the job", async () => {
    const { query, calls } = makeQuery([]);

    const row = await saveReviewedDesignAnalysis(
        { designId: 5, serviceId: "svc-a", documentSchema: "x/v1", document: DOCUMENT, userId: 3 },
        query
    );

    assert.equal(row, null);
    assert.deepEqual(calls[0].sqlParams, [5, "svc-a", "x/v1", JSON.stringify(DOCUMENT), 3]);
    assert.ok(calls[0].sql.includes(
        `WHERE design_id = $1 AND service_id = $2 AND NOT ${generationInFlight().replace(/\s+/g, " ")}`
    ));
    assert.match(calls[0].sql, /job_id = NULL/);
});

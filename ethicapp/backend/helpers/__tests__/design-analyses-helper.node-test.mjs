import assert from "node:assert/strict";
import test from "node:test";

import { generationInFlight } from "../analyses-store-helper.js";
import {
    completeDesignAnalysis,
    copyReadyDesignAnalyses,
    failDesignAnalysis,
    getDesignAnalysis,
    listDesignAnalyses,
    markDesignAnalysisProcessing,
    releaseUnstartedDesignAnalysis,
    reserveDesignAnalysisForSavedInput,
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

const SNAPSHOT = { fingerprint: "fp-1", caseId: 42 };

// The design check that binds a reservation to the design snapshot its input
// was prepared from, locking the design row for the statement.
const CURRENT_DESIGN_CHECK = "WITH current_design AS ( SELECT d.id FROM designs AS d "
    + "WHERE d.id = $1::integer AND md5(d.design::text) IS NOT DISTINCT FROM $5::text "
    + "AND d.case_id IS NOT DISTINCT FROM $6::integer AND d.locked IS NOT TRUE FOR SHARE )";

test("reserveDesignAnalysisGeneration: creates or re-reserves the row in one statement", async () => {
    const { query, calls } = makeQuery([{ design_current: true, status: "requested", job_id: JOB_ID }]);

    const result = await reserveDesignAnalysisGeneration(
        { designId: 5, serviceId: "svc-a", inputHash: "sha256:abc", userId: 3, designSnapshot: SNAPSHOT },
        query
    );

    assert.deepEqual(result, {
        designChanged: false,
        reservation:   { status: "requested", job_id: JOB_ID },
    });
    assert.equal(calls.length, 1, "the checks and the reservation are the same statement");
    assert.deepEqual(calls[0].sqlParams, [5, "svc-a", "sha256:abc", 3, "fp-1", 42]);
    assert.ok(calls[0].sql.startsWith(CURRENT_DESIGN_CHECK));
    assert.ok(calls[0].sql.includes(
        "INSERT INTO design_analyses AS da (design_id, service_id, job_id, input_hash, requested_by) "
            + "SELECT current_design.id, $2::text, gen_random_uuid(), $3::text, $4::integer "
            + "FROM current_design "
            + "ON CONFLICT (design_id, service_id) DO UPDATE"
    ));
    assert.match(calls[0].sql, /SET status = 'requested', job_id = EXCLUDED\.job_id, input_hash = EXCLUDED\.input_hash/);
    assert.ok(calls[0].sql.includes(`WHERE NOT (${generationInFlight("da").replace(/\s+/g, " ")}) RETURNING`));
    assert.ok(calls[0].sql.endsWith(
        "SELECT EXISTS (SELECT 1 FROM current_design) AS design_current, reserved.* "
            + "FROM (SELECT 1) AS single_row LEFT JOIN reserved ON true;"
    ));
    assert.doesNotMatch(calls[0].sql, /document =/, "the previous document is kept");
    assert.doesNotMatch(calls[0].sql, /input_hash IS NOT DISTINCT FROM/, "it runs whatever the stored hash");
});

test("reserveDesignAnalysisGeneration: a changed design, or a generation in flight, reserves nothing", async () => {
    const changed = makeQuery([{ design_current: false, job_id: null }]);
    const inFlight = makeQuery([{ design_current: true, job_id: null, status: null }]);
    const args = { designId: 5, serviceId: "svc-a", designSnapshot: SNAPSHOT };

    assert.deepEqual(
        await reserveDesignAnalysisGeneration(args, changed.query),
        { designChanged: true, reservation: null }
    );
    assert.deepEqual(
        await reserveDesignAnalysisGeneration(args, inFlight.query),
        { designChanged: false, reservation: null }
    );
});

test("reserveDesignAnalysisGeneration: requires the design snapshot", async () => {
    const { query, calls } = makeQuery([]);

    await assert.rejects(
        reserveDesignAnalysisGeneration({ designId: 5, serviceId: "svc-a" }, query),
        TypeError
    );
    assert.equal(calls.length, 0);
});

test("reserveDesignAnalysisForSavedInput: skips a covered input, supersedes a changed one", async () => {
    const { query, calls } = makeQuery([{ design_current: true, status: "requested", job_id: JOB_ID }]);

    const result = await reserveDesignAnalysisForSavedInput(
        { designId: 5, serviceId: "svc-a", inputHash: "sha256:new", userId: 3, designSnapshot: SNAPSHOT },
        query
    );

    assert.deepEqual(result, {
        designChanged: false,
        reservation:   { status: "requested", job_id: JOB_ID },
    });
    assert.equal(calls.length, 1, "the checks and the reservation are the same statement");
    assert.deepEqual(calls[0].sqlParams, [5, "svc-a", "sha256:new", 3, "fp-1", 42]);
    assert.ok(calls[0].sql.startsWith(CURRENT_DESIGN_CHECK), "bound to the design snapshot");
    assert.ok(calls[0].sql.includes(
        "INSERT INTO design_analyses AS da (design_id, service_id, job_id, input_hash, requested_by)"
    ));
    // Refused only when the stored row has the same hash and its generation
    // is in flight or succeeded: a different hash supersedes a generation in
    // flight.
    assert.ok(calls[0].sql.includes(
        "WHERE NOT (da.input_hash IS NOT DISTINCT FROM EXCLUDED.input_hash AND "
            + `(${generationInFlight("da").replace(/\s+/g, " ")} OR `
            + "(da.status = 'ready' AND da.error_code IS NULL))) RETURNING"
    ));
});

test("reserveDesignAnalysisForSavedInput: requires an input hash", async () => {
    const { query, calls } = makeQuery([]);

    for (const inputHash of [undefined, null, ""]) {
        await assert.rejects(
            reserveDesignAnalysisForSavedInput({ designId: 5, serviceId: "svc-a", inputHash }, query),
            TypeError
        );
    }
    assert.equal(calls.length, 0);
});

test("copyReadyDesignAnalyses: copies ready rows with their hash, without job or review", async () => {
    const { query, calls } = makeQuery([{ service_id: "svc-a" }]);

    const rows = await copyReadyDesignAnalyses({ sourceDesignId: 5, targetDesignId: 9 }, query);

    assert.deepEqual(rows, [{ service_id: "svc-a" }]);
    assert.deepEqual(calls[0].sqlParams, [5, 9]);
    assert.ok(calls[0].sql.includes(
        "INSERT INTO design_analyses (design_id, service_id, status, document_schema, document, "
            + "input_hash, error_code, error_message, requested_at, generated_at) "
            + "SELECT $2, source.service_id, 'ready',"
    ));
    assert.ok(calls[0].sql.includes(
        "WHERE source.design_id = $1 AND source.status = 'ready' AND source.document IS NOT NULL"
    ));
    assert.match(calls[0].sql, /ON CONFLICT \(design_id, service_id\) DO NOTHING/);
    assert.doesNotMatch(calls[0].sql, /job_id|reviewed_|requested_by/);
});

test("reserveDesignAnalysisGeneration: without a hash, user or case they are NULL", async () => {
    const { query, calls } = makeQuery([{ design_current: true, status: "requested" }]);

    await reserveDesignAnalysisGeneration(
        { designId: 5, serviceId: "svc-a", designSnapshot: { fingerprint: "fp-1" } },
        query
    );

    assert.deepEqual(calls[0].sqlParams, [5, "svc-a", null, null, "fp-1", null]);
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

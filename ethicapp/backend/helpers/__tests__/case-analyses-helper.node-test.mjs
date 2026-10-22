import assert from "node:assert/strict";
import test from "node:test";

import {
    completeCaseAnalysis,
    failCaseAnalysis,
    getCaseAnalysis,
    insertRequestedCaseAnalyses,
    listCaseAnalyses,
    markCaseAnalysisProcessing,
    saveReviewedCaseAnalysis,
    STALE_PROCESSING_INTERVAL,
} from "../case-analyses-helper.js";

const JOB_ID   = "d1e2f3a4-0000-4000-8000-000000000031";
const DOCUMENT = { items: [{ id: "EV1" }] };

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

// ─── opt-in and reads ────────────────────────────────────────────────────────

test("insertRequestedCaseAnalyses: one insert for all choices, skips existing rows", async () => {
    const { query, calls } = makeQuery([{ service_id: "svc-a" }, { service_id: "svc-b" }]);

    const rows = await insertRequestedCaseAnalyses(
        { caseId: 7, serviceIds: ["svc-a", "svc-b"], userId: 3 },
        query
    );

    assert.equal(rows.length, 2);
    assert.deepEqual(calls[0].sqlParams, [7, ["svc-a", "svc-b"], 3]);
    assert.match(calls[0].sql, /INSERT INTO case_analyses \(case_id, service_id, requested_by\)/);
    assert.match(calls[0].sql, /SELECT \$1, service_id, \$3 FROM unnest\(\$2::text\[\]\)/);
    assert.match(calls[0].sql, /ON CONFLICT \(case_id, service_id\) DO NOTHING/);
});

test("insertRequestedCaseAnalyses: sends no query when no service was chosen", async () => {
    const { query, calls } = makeQuery();

    const rows = await insertRequestedCaseAnalyses({ caseId: 7, serviceIds: [], userId: 3 }, query);

    assert.deepEqual(rows, []);
    assert.equal(calls.length, 0);
});

test("listCaseAnalyses: selects the analyses of a case without their documents", async () => {
    const { query, calls } = makeQuery([{ service_id: "svc-a" }]);

    const rows = await listCaseAnalyses(7, query);

    assert.deepEqual(rows, [{ service_id: "svc-a" }]);
    assert.deepEqual(calls[0].sqlParams, [7]);
    assert.match(calls[0].sql, /FROM case_analyses WHERE case_id = \$1/);
    assert.match(calls[0].sql, /AS is_stale/);
    assert.doesNotMatch(calls[0].sql, /\bdocument,/);
});

test("getCaseAnalysis: selects one analysis with its document, or null", async () => {
    const found = makeQuery([{ service_id: "svc-a" }]);
    const missing = makeQuery([]);

    assert.deepEqual(
        await getCaseAnalysis({ caseId: 7, serviceId: "svc-a" }, found.query),
        { service_id: "svc-a" }
    );
    assert.equal(await getCaseAnalysis({ caseId: 7, serviceId: "svc-x" }, missing.query), null);
    assert.deepEqual(found.calls[0].sqlParams, [7, "svc-a"]);
    assert.match(found.calls[0].sql, /\bdocument,/);
    assert.match(found.calls[0].sql, /WHERE case_id = \$1 AND service_id = \$2/);
});

// ─── adapter updates ─────────────────────────────────────────────────────────

test("markCaseAnalysisProcessing: sets the new job without touching the document", async () => {
    const { query, calls } = makeQuery([{ status: "processing" }]);

    const row = await markCaseAnalysisProcessing(
        { caseId: 7, serviceId: "svc-a", jobId: JOB_ID },
        query
    );

    assert.deepEqual(row, { status: "processing" });
    assert.deepEqual(calls[0].sqlParams, [7, "svc-a", JOB_ID]);
    assert.match(calls[0].sql, /SET status = 'processing', job_id = \$3::uuid/);
    assert.match(calls[0].sql, /WHERE case_id = \$1 AND service_id = \$2 RETURNING/);
    assert.doesNotMatch(calls[0].sql, /document =/);
});

test("markCaseAnalysisProcessing: null when the service was not chosen for the case", async () => {
    const { query } = makeQuery([]);

    assert.equal(
        await markCaseAnalysisProcessing({ caseId: 7, serviceId: "svc-x", jobId: JOB_ID }, query),
        null
    );
});

test("completeCaseAnalysis: conditions the update on the job and clears the review", async () => {
    const { query, calls } = makeQuery([]);

    const row = await completeCaseAnalysis(
        { serviceId: "svc-a", jobId: JOB_ID, documentSchema: "mock/v1", document: DOCUMENT },
        query
    );

    assert.equal(row, null, "a superseded job updates no row");
    assert.deepEqual(calls[0].sqlParams, ["svc-a", JOB_ID, "mock/v1", JSON.stringify(DOCUMENT)]);
    assert.ok(calls[0].sql.includes(CURRENT_JOB_CONDITION));
    assert.match(calls[0].sql, /document = \$4::jsonb/);
    assert.match(calls[0].sql, /reviewed_at = NULL, reviewed_by = NULL/);
});

test("failCaseAnalysis: conditions the update on the job and keeps any document", async () => {
    const { query, calls } = makeQuery([{ status: "ready" }]);

    await failCaseAnalysis(
        { serviceId: "svc-a", jobId: JOB_ID, errorCode: "render-failed", errorMessage: "No text." },
        query
    );
    await failCaseAnalysis({ serviceId: "svc-a", jobId: JOB_ID }, query);

    assert.deepEqual(calls[0].sqlParams, ["svc-a", JOB_ID, "render-failed", "No text."]);
    assert.deepEqual(calls[1].sqlParams, ["svc-a", JOB_ID, null, null]);
    assert.match(calls[0].sql, /CASE WHEN document IS NULL THEN 'failed' ELSE 'ready' END/);
    assert.ok(calls[0].sql.includes(CURRENT_JOB_CONDITION));
    assert.doesNotMatch(calls[0].sql, /document =/);
});

// ─── teacher edits ───────────────────────────────────────────────────────────

test("saveReviewedCaseAnalysis: condition excludes fresh generations; drops the job", async () => {
    const { query, calls } = makeQuery([]);

    const row = await saveReviewedCaseAnalysis(
        { caseId: 7, serviceId: "svc-a", documentSchema: "mock/v1", document: DOCUMENT, userId: 3 },
        query
    );

    assert.equal(row, null, "no row is updated while a fresh generation runs");
    assert.deepEqual(calls[0].sqlParams, [7, "svc-a", "mock/v1", JSON.stringify(DOCUMENT), 3]);
    const staleCondition = "AND (status <> 'processing' OR updated_at < now() - interval "
        + `'${STALE_PROCESSING_INTERVAL}')`;
    assert.ok(calls[0].sql.includes(staleCondition));
    assert.match(calls[0].sql, /job_id = NULL/);
    assert.match(calls[0].sql, /reviewed_at = now\(\), reviewed_by = \$5/);
});

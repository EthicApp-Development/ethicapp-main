// Integration tests for design analyses (#847, #848), against a real
// PostgreSQL database with migrations V1-V25 applied: the reservation upserts
// (explicit and on save, with their input hash, in-flight, superseding and
// stale conditions), the conditional completion and failure, the copy of
// ready analyses, and the cascade on design deletion cannot be checked with
// fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import {
    completeDesignAnalysis,
    copyReadyDesignAnalyses,
    failDesignAnalysis,
    getDesignAnalysis,
    listDesignAnalyses,
    markDesignAnalysisProcessing,
    releaseUnstartedDesignAnalysis,
    reserveDesignAnalysisForSavedInput as reserveForSavedInputResult,
    reserveDesignAnalysisGeneration as reserveGenerationResult,
    saveReviewedDesignAnalysis,
} from "../design-analyses-helper.js";
import {
    designSnapshotOf,
    readDesignForAnalyses,
    requestDesignAnalysesOnSave,
} from "../design-analyses-lifecycle-helper.js";
import {
    designAnalysisInput as mockDesignAnalysisInput,
    buildMockDesignAnalysis,
    MOCK_DESIGN_ANALYSIS_SCHEMA,
} from "../../external-services/adapters/mock-design-analysis.adapter.js";

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

// The snapshot of the design as stored now, as a reader of the design would
// bind its reservation to.
async function currentSnapshot(designId) {
    return designSnapshotOf(await readDesignForAnalyses(designId, query));
}

// Reservations bound to the current design, returning the reserved row or
// null, for the tests that are not about the design snapshot.
async function reserveDesignAnalysisGeneration(args) {
    const designSnapshot = args.designSnapshot ?? await currentSnapshot(args.designId);
    return (await reserveGenerationResult({ ...args, designSnapshot }, query)).reservation;
}

async function reserveDesignAnalysisForSavedInput(args) {
    const designSnapshot = args.designSnapshot ?? await currentSnapshot(args.designId);
    return (await reserveForSavedInputResult({ ...args, designSnapshot }, query)).reservation;
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

// ─── analyses on save (#848) ─────────────────────────────────────────────────

const saveReserve = (ids, inputHash) =>
    reserveDesignAnalysisForSavedInput({ ...ids, inputHash }, query);

test("design analyses on save: the first save creates the row; an unchanged ready input runs nothing", { skip: SKIP_REASON }, async () => {
    const { designId, serviceId, userId } = await createDesign();
    const ids = { designId, serviceId };

    const first = await reserveDesignAnalysisForSavedInput({ ...ids, inputHash: "hash-1", userId }, query);
    assert.equal(first.status, "requested");
    assert.equal(first.input_hash, "hash-1");

    await markDesignAnalysisProcessing({ ...ids, jobId: first.job_id }, query);
    await completeDesignAnalysis({
        serviceId, jobId: first.job_id, documentSchema: "claim-typology/v1", document: { version: 1 },
    }, query);

    assert.equal(await saveReserve(ids, "hash-1"), null, "the same input is already analysed");
    const changed = await saveReserve(ids, "hash-2");
    assert.ok(changed, "a changed input runs again");
    assert.equal(changed.input_hash, "hash-2");
    assert.deepEqual((await getDesignAnalysis(ids, query)).document, { version: 1 },
        "the previous document stays readable");
});

test("design analyses on save: the same input in flight is not duplicated; a changed one supersedes it", { skip: SKIP_REASON }, async () => {
    const { designId, serviceId } = await createDesign();
    const ids = { designId, serviceId };

    const first = await saveReserve(ids, "hash-1");
    assert.equal(await saveReserve(ids, "hash-1"), null, "requested with the same input");

    await markDesignAnalysisProcessing({ ...ids, jobId: first.job_id }, query);
    assert.equal(await saveReserve(ids, "hash-1"), null, "processing with the same input");

    // An explicit regeneration still answers 409 while in flight.
    assert.equal(await reserveDesignAnalysisGeneration({ ...ids, inputHash: "hash-2" }, query), null);

    const second = await saveReserve(ids, "hash-2");
    assert.ok(second, "a changed input supersedes the generation in flight");
    assert.notEqual(second.job_id, first.job_id);
    assert.equal(second.status, "requested");

    assert.equal(await completeDesignAnalysis({
        serviceId, jobId: first.job_id, documentSchema: "claim-typology/v1", document: { late: true },
    }, query), null, "the superseded job's late result is not stored");
    assert.equal(await failDesignAnalysis({ serviceId, jobId: first.job_id, errorCode: "late" }, query), null);

    await markDesignAnalysisProcessing({ ...ids, jobId: second.job_id }, query);
    await completeDesignAnalysis({
        serviceId, jobId: second.job_id, documentSchema: "claim-typology/v1", document: { version: 2 },
    }, query);
    const row = await getDesignAnalysis(ids, query);
    assert.equal(row.status, "ready");
    assert.equal(row.input_hash, "hash-2");
    assert.deepEqual(row.document, { version: 2 });
});

test("design analyses on save: a failed, unstarted or stale generation of the same input runs again", { skip: SKIP_REASON }, async () => {
    const { designId, serviceId } = await createDesign();
    const ids = { designId, serviceId };

    // Failed without a document.
    const failedRun = await saveReserve(ids, "hash-1");
    await markDesignAnalysisProcessing({ ...ids, jobId: failedRun.job_id }, query);
    await failDesignAnalysis({ serviceId, jobId: failedRun.job_id, errorCode: "timeout" }, query);
    const retried = await saveReserve(ids, "hash-1");
    assert.ok(retried, "a failed analysis runs again");

    // Ready with an older document, after its latest generation was not started.
    await markDesignAnalysisProcessing({ ...ids, jobId: retried.job_id }, query);
    await completeDesignAnalysis({
        serviceId, jobId: retried.job_id, documentSchema: "claim-typology/v1", document: { version: 1 },
    }, query);
    const unstarted = await saveReserve(ids, "hash-2");
    await releaseUnstartedDesignAnalysis({ ...ids, jobId: unstarted.job_id }, query);
    const row = await getDesignAnalysis(ids, query);
    assert.equal(row.status, "ready");
    assert.equal(row.input_hash, "hash-2");
    assert.equal(row.error_code, "generation-not-started");
    assert.ok(await saveReserve(ids, "hash-2"), "the document is not the one of hash-2");

    // Stale with the same input.
    await makeStale(ids);
    assert.ok(await saveReserve(ids, "hash-2"), "a stale generation does not block");
});

test("design analyses on save: a row stored without an input hash is regenerated", { skip: SKIP_REASON }, async () => {
    const { designId, serviceId } = await createDesign();
    const ids = { designId, serviceId };

    await generate(ids, { inputHash: null, document: { version: 1 } });

    assert.ok(await saveReserve(ids, "hash-1"));
});

test("design analyses on save: of concurrent saves with the same input one reserves", { skip: SKIP_REASON }, async () => {
    const { designId, serviceId } = await createDesign();

    const results = await Promise.all(Array.from({ length: 5 }, () =>
        saveReserve({ designId, serviceId }, "hash-1")
    ));

    assert.equal(results.filter(Boolean).length, 1);
});

test("design analyses: a copy gets the source's ready analyses only", { skip: SKIP_REASON }, async () => {
    const source = await createDesign();
    const [copy] = await dbQuery(`
        INSERT INTO designs (creator, design)
        VALUES ($1, '{}'::jsonb)
        RETURNING id;
    `, [source.userId]);
    const services = {
        ready:     `${source.serviceId}-ready`,
        failedRun: `${source.serviceId}-failed-run`,
        inFlight:  `${source.serviceId}-in-flight`,
        failed:    `${source.serviceId}-failed`,
    };
    const ids = serviceId => ({ designId: source.designId, serviceId });

    await generate(ids(services.ready), { inputHash: "hash-ready", document: { version: 1 } });
    const readyRow = await getDesignAnalysis(ids(services.ready), query);

    await generate(ids(services.failedRun), { inputHash: "hash-1", document: { version: 1 } });
    const failedRun = await reserveDesignAnalysisGeneration(
        { ...ids(services.failedRun), inputHash: "hash-2" },
        query
    );
    await markDesignAnalysisProcessing({ ...ids(services.failedRun), jobId: failedRun.job_id }, query);
    await failDesignAnalysis({ serviceId: services.failedRun, jobId: failedRun.job_id, errorCode: "timeout" }, query);

    await generate(ids(services.inFlight), { inputHash: "hash-1", document: { version: 1 } });
    await reserveDesignAnalysisGeneration({ ...ids(services.inFlight), inputHash: "hash-2" }, query);

    const failed = await reserveDesignAnalysisGeneration({ ...ids(services.failed), inputHash: "h" }, query);
    await markDesignAnalysisProcessing({ ...ids(services.failed), jobId: failed.job_id }, query);
    await failDesignAnalysis({ serviceId: services.failed, jobId: failed.job_id, errorCode: "timeout" }, query);

    const copied = await copyReadyDesignAnalyses(
        { sourceDesignId: source.designId, targetDesignId: copy.id },
        query
    );
    assert.deepEqual(copied.map(row => row.service_id).sort(), [services.failedRun, services.ready].sort());

    const copyReady = await getDesignAnalysis({ designId: copy.id, serviceId: services.ready }, query);
    assert.equal(copyReady.status, "ready");
    assert.deepEqual(copyReady.document, { version: 1 });
    assert.equal(copyReady.document_schema, "claim-typology/v1");
    assert.equal(copyReady.input_hash, "hash-ready");
    assert.equal(copyReady.generated_at.getTime(), readyRow.generated_at.getTime());
    assert.equal(copyReady.job_id, null);
    assert.equal(copyReady.requested_by, null);
    assert.equal(copyReady.reviewed_at, null);

    // The copy's unchanged save runs nothing; its failed run is requested again.
    assert.equal(await saveReserve({ designId: copy.id, serviceId: services.ready }, "hash-ready"), null);
    const copyFailedRun = await getDesignAnalysis({ designId: copy.id, serviceId: services.failedRun }, query);
    assert.equal(copyFailedRun.error_code, "timeout");
    assert.ok(await saveReserve({ designId: copy.id, serviceId: services.failedRun }, "hash-2"));

    // Copying again keeps what the copy already has.
    assert.deepEqual(await copyReadyDesignAnalyses(
        { sourceDesignId: source.designId, targetDesignId: copy.id },
        query
    ), []);
});

// ─── saves that overlap (#848 review) ────────────────────────────────────────

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

const TUTOR_PHASE = { externalServices: { enabledServiceIds: ["argumentation-tutor-system"] } };

function tutorDesign(questionText) {
    return {
        type:   "semantic_differential",
        valid:  true,
        phases: [{ ...TUTOR_PHASE, questions: [{ q_text: questionText }] }],
    };
}

// A valid design with a case and one tutor question, as a save stores it.
async function createSavedDesign(questionText) {
    const { userId, designId, serviceId } = await createDesign();
    const [ethicalCase] = await dbQuery(`
        INSERT INTO ethical_cases
            (title, author_firstname, author_lastname, author_email, pdf_path, creator)
        VALUES ('A case', 'Ana', 'Author', 'ana@integration.test', '/uploads/cases/x/case.pdf', $1)
        RETURNING id;
    `, [userId]);
    await dbQuery(`
        UPDATE designs
        SET design = $2::jsonb,
            case_id = $3
        WHERE id = $1;
    `, [designId, JSON.stringify(tutorDesign(questionText)), ethicalCase.id]);
    return { userId, designId, serviceId, caseId: ethicalCase.id };
}

// The content update of PATCH /designs/:id.
async function saveDesign(designId, questionText) {
    await dbQuery(`
        UPDATE designs
        SET design = $2::jsonb
        WHERE id = $1
          AND locked IS NOT TRUE;
    `, [designId, JSON.stringify(tutorDesign(questionText))]);
}

/**
 * Runs the save-time request of a design against the database, with the mock
 * design analysis as the only design-scoped service. `caseLoaded` holds the
 * save between reading the design and reserving; `generationStarted` and
 * `storeResult` hold its generation between starting and storing its result.
 */
function runSaveRequest(ids, { designRead, caseLoaded, generationStarted, storeResult } = {}) {
    const completions = [];
    const result = requestDesignAnalysesOnSave(ids.designId, {
        dependencies: {
            getDesignRow: async designId => {
                const row = await readDesignForAnalyses(designId, query);
                designRead?.resolve();
                return row;
            },
            loadCase: async caseId => {
                await caseLoaded;
                return { id: caseId, title: "A case", languageCode: "es", contentHash: "sha256:pdf" };
            },
            registry: {
                initialize:                    async () => {},
                getUsableServiceIdsForScope:   async () => [ids.serviceId],
                getDesignAnalysisInputBuilder: () => mockDesignAnalysisInput,
            },
            reserve:  args => reserveForSavedInputResult(args, query),
            dispatch: async (context, { reservations: [reservation] }) => {
                const jobId = reservation.job_id;
                const started = await markDesignAnalysisProcessing(
                    { designId: ids.designId, serviceId: ids.serviceId, jobId },
                    query
                );
                generationStarted?.resolve();
                await storeResult;
                completions.push(started && await completeDesignAnalysis({
                    serviceId:      ids.serviceId,
                    jobId,
                    documentSchema: MOCK_DESIGN_ANALYSIS_SCHEMA,
                    document:       buildMockDesignAnalysis(context.analysisInput),
                }, query));
                return [];
            },
        },
    });
    return { result, completions };
}

const storedQuestion = async ids =>
    (await getDesignAnalysis(ids, query))?.document?.questions?.[0]?.text ?? null;

test("design analyses on save: a save overtaken before reserving reserves nothing", { skip: SKIP_REASON }, async () => {
    const ids = await createSavedDesign("OLD question");

    // Save A reads the old design and stops before reserving.
    const designReadA = deferred();
    const caseLoadedA = deferred();
    const saveA = runSaveRequest(ids, { designRead: designReadA, caseLoaded: caseLoadedA.promise });
    await designReadA.promise;

    // Save B stores the new question, reserves and completes.
    await saveDesign(ids.designId, "NEW question");
    const saveB = runSaveRequest(ids);
    const resultB = await saveB.result;
    assert.equal(resultB.services[0].outcome, "requested");
    assert.equal(await storedQuestion(ids), "NEW question");

    // Save A resumes: its reservation is rejected.
    caseLoadedA.resolve();
    const resultA = await saveA.result;
    assert.deepEqual(resultA.services, [{ serviceId: ids.serviceId, outcome: "design-changed" }]);

    const row = await getDesignAnalysis(ids, query);
    assert.equal(row.status, "ready");
    assert.equal(row.job_id, resultB.services[0].jobId);
    assert.equal(await storedQuestion(ids), "NEW question");
});

test("design analyses on save: a save that reserved first is superseded, and its late result dropped", { skip: SKIP_REASON }, async () => {
    const ids = await createSavedDesign("OLD question");

    // Save A reserves and starts its generation, which answers late.
    const startedA = deferred();
    const resultArrivesA = deferred();
    const saveA = runSaveRequest(ids, {
        generationStarted: startedA,
        storeResult:       resultArrivesA.promise,
    });
    await startedA.promise;

    // Save B stores the new question, supersedes A and completes.
    await saveDesign(ids.designId, "NEW question");
    const resultB = await runSaveRequest(ids).result;
    assert.equal(resultB.services[0].outcome, "requested");

    resultArrivesA.resolve();
    const resultA = await saveA.result;
    assert.equal(resultA.services[0].outcome, "requested");
    assert.deepEqual(saveA.completions, [null], "the superseded job stores nothing");

    const row = await getDesignAnalysis(ids, query);
    assert.equal(row.status, "ready");
    assert.equal(row.job_id, resultB.services[0].jobId);
    assert.equal(await storedQuestion(ids), "NEW question");
});

test("design analyses on save: a reservation waits for a save in progress, then checks the saved design", { skip: SKIP_REASON }, async () => {
    const ids = await createSavedDesign("OLD question");
    const snapshotA = await currentSnapshot(ids.designId);
    const reserveA = () => reserveForSavedInputResult(
        { ...ids, inputHash: "hash-old", designSnapshot: snapshotA },
        query
    );

    // A save whose update is not committed yet holds the design row.
    const rolledBack = await getPool().connect();
    try {
        await rolledBack.query("BEGIN;");
        await rolledBack.query("UPDATE designs SET design = $2::jsonb WHERE id = $1;", [
            ids.designId, JSON.stringify(tutorDesign("DISCARDED question")),
        ]);
        const pending = reserveA();
        await new Promise(resolve => setTimeout(resolve, 100));
        await rolledBack.query("ROLLBACK;");
        const result = await pending;
        assert.equal(result.designChanged, false, "the design did not change");
        assert.ok(result.reservation);
    } finally {
        rolledBack.release();
    }

    const committed = await getPool().connect();
    try {
        await committed.query("BEGIN;");
        await committed.query("UPDATE designs SET design = $2::jsonb WHERE id = $1;", [
            ids.designId, JSON.stringify(tutorDesign("NEW question")),
        ]);
        const pending = reserveForSavedInputResult(
            { ...ids, inputHash: "hash-old-2", designSnapshot: snapshotA },
            query
        );
        await new Promise(resolve => setTimeout(resolve, 100));
        await committed.query("COMMIT;");
        assert.deepEqual(await pending, { designChanged: true, reservation: null });
    } finally {
        committed.release();
    }

    assert.equal((await getDesignAnalysis(ids, query)).input_hash, "hash-old");
});

test("design analyses: an explicit generation from an outdated or locked design reserves nothing", { skip: SKIP_REASON }, async () => {
    const ids = await createSavedDesign("OLD question");
    const outdated = await currentSnapshot(ids.designId);
    await saveDesign(ids.designId, "NEW question");

    assert.deepEqual(
        await reserveGenerationResult({ ...ids, inputHash: "hash-1", designSnapshot: outdated }, query),
        { designChanged: true, reservation: null }
    );

    const current = await currentSnapshot(ids.designId);
    await dbQuery("UPDATE designs SET locked = true WHERE id = $1;", [ids.designId]);
    assert.deepEqual(
        await reserveGenerationResult({ ...ids, inputHash: "hash-1", designSnapshot: current }, query),
        { designChanged: true, reservation: null }
    );
    assert.equal(await getDesignAnalysis(ids, query), null);
});

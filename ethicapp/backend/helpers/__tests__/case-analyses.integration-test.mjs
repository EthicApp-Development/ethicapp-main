// Integration tests for the case analyses of a copy of a case (#1038), against
// a real PostgreSQL database with migrations V1-V21 or later applied: the copy
// of ready analyses (which rows, which columns, the rows a copy already has),
// the reservation of the services the copy did not inherit, and a new
// generation of an inherited analysis, which changes the copy only.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import {
    completeCaseAnalysis,
    copyReadyCaseAnalyses,
    failCaseAnalysis,
    getCaseAnalysis,
    insertRequestedCaseAnalyses,
    listCaseAnalyses,
    markCaseAnalysisProcessing,
    reserveCaseAnalysisGeneration,
    saveReviewedCaseAnalysis,
} from "../case-analyses-helper.js";
import { requestCaseCopyAnalyses } from "../case-lifecycle-helper.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    return pool;
}

const dbQuery = async (sql, params = []) => (await getPool().query(sql, params)).rows;

// The helpers' query signature, over the integration pool.
const query = ({ sql, sqlParams }) => dbQuery(sql, sqlParams);

test.after(async () => {
    await pool?.end();
});

async function createTeacher() {
    const suffix = randomUUID();
    const [user] = await dbQuery(`
        INSERT INTO users (name, rut, mail, role)
        VALUES ('Integration teacher', $1, $2, 'P')
        RETURNING id;
    `, [suffix, `${suffix}@integration.test`]);
    return user.id;
}

async function createCase(userId) {
    const [ethicalCase] = await dbQuery(`
        INSERT INTO ethical_cases
            (title, author_firstname, author_lastname, author_email, pdf_path, creator)
        VALUES ('A case', 'Ana', 'Author', 'ana@integration.test', '/uploads/cases/x/case.pdf', $1)
        RETURNING id, case_uuid, title, pdf_path, language_code, visibility;
    `, [userId]);
    return ethicalCase;
}

// Chooses a service for the case and runs its first generation to the end.
async function generate({ caseId, serviceId, userId }, document) {
    const [reservation] = await insertRequestedCaseAnalyses({ caseId, serviceIds: [serviceId], userId }, query);
    await markCaseAnalysisProcessing({ caseId, serviceId, jobId: reservation.job_id }, query);
    await completeCaseAnalysis({
        serviceId,
        jobId:          reservation.job_id,
        documentSchema: "evidence-inventory/v1",
        document,
    }, query);
}

// A source case with one analysis in each state a copy must tell apart.
async function createSourceWithAnalyses() {
    const authorId = await createTeacher();
    const source = await createCase(authorId);
    const prefix = `svc-case-${randomUUID()}`;
    const services = {
        ready:     `${prefix}-ready`,
        reviewed:  `${prefix}-reviewed`,
        failedRun: `${prefix}-failed-run`,
        inFlight:  `${prefix}-in-flight`,
        failed:    `${prefix}-failed`,
        requested: `${prefix}-requested`,
    };
    const ids = serviceId => ({ caseId: source.id, serviceId, userId: authorId });

    await generate(ids(services.ready), { version: 1 });

    await generate(ids(services.reviewed), { version: 1 });
    await saveReviewedCaseAnalysis({
        ...ids(services.reviewed),
        documentSchema: "evidence-inventory/v1",
        document:       { version: 1, edited: true },
    }, query);

    // A ready document whose latest generation failed.
    await generate(ids(services.failedRun), { version: 1 });
    const failedRun = await reserveCaseAnalysisGeneration(ids(services.failedRun), query);
    await markCaseAnalysisProcessing({ ...ids(services.failedRun), jobId: failedRun.job_id }, query);
    await failCaseAnalysis({
        serviceId:    services.failedRun,
        jobId:        failedRun.job_id,
        errorCode:    "timeout",
        errorMessage: "Too slow.",
    }, query);

    // A document being generated again: it is not 'ready' now.
    await generate(ids(services.inFlight), { version: 1 });
    await reserveCaseAnalysisGeneration(ids(services.inFlight), query);

    // Failed without a document, and chosen but never started.
    const [failed] = await insertRequestedCaseAnalyses(
        { caseId: source.id, serviceIds: [services.failed], userId: authorId },
        query
    );
    await markCaseAnalysisProcessing({ ...ids(services.failed), jobId: failed.job_id }, query);
    await failCaseAnalysis({ serviceId: services.failed, jobId: failed.job_id, errorCode: "timeout" }, query);
    await insertRequestedCaseAnalyses(
        { caseId: source.id, serviceIds: [services.requested], userId: authorId },
        query
    );

    return { authorId, source, services };
}

test("case analyses: a copy gets the source's ready analyses only, without job, requester or review", { skip: SKIP_REASON }, async () => {
    const { source, services } = await createSourceWithAnalyses();
    const copierId = await createTeacher();
    const copy = await createCase(copierId);
    const sourceReady = await getCaseAnalysis({ caseId: source.id, serviceId: services.ready }, query);

    const copied = await copyReadyCaseAnalyses({ sourceCaseId: source.id, targetCaseId: copy.id }, query);
    assert.deepEqual(
        copied.map(row => row.service_id).sort(),
        [services.failedRun, services.ready, services.reviewed].sort()
    );

    const copyReady = await getCaseAnalysis({ caseId: copy.id, serviceId: services.ready }, query);
    assert.equal(copyReady.status, "ready");
    assert.deepEqual(copyReady.document, { version: 1 });
    assert.equal(copyReady.document_schema, "evidence-inventory/v1");
    assert.equal(copyReady.generated_at.getTime(), sourceReady.generated_at.getTime());
    assert.equal(copyReady.requested_at.getTime(), sourceReady.requested_at.getTime());
    assert.equal(copyReady.job_id, null);
    assert.equal(copyReady.requested_by, null);
    assert.equal(copyReady.error_code, null);

    // A reviewed document is copied as it stands, without its review.
    const copyReviewed = await getCaseAnalysis({ caseId: copy.id, serviceId: services.reviewed }, query);
    assert.deepEqual(copyReviewed.document, { version: 1, edited: true });
    assert.equal(copyReviewed.reviewed_at, null);
    assert.equal(copyReviewed.reviewed_by, null);

    // The failure of the latest generation travels with the document it kept.
    const copyFailedRun = await getCaseAnalysis({ caseId: copy.id, serviceId: services.failedRun }, query);
    assert.equal(copyFailedRun.status, "ready");
    assert.deepEqual(copyFailedRun.document, { version: 1 });
    assert.equal(copyFailedRun.error_code, "timeout");
    assert.equal(copyFailedRun.error_message, "Too slow.");

    for (const serviceId of [services.inFlight, services.failed, services.requested]) {
        assert.equal(await getCaseAnalysis({ caseId: copy.id, serviceId }, query), null, serviceId);
    }

    // Copying again keeps what the copy already has.
    assert.deepEqual(
        await copyReadyCaseAnalyses({ sourceCaseId: source.id, targetCaseId: copy.id }, query),
        []
    );
});

test("case analyses: a source without ready analyses gives its copy none", { skip: SKIP_REASON }, async () => {
    const authorId = await createTeacher();
    const source = await createCase(authorId);
    const copy = await createCase(authorId);

    assert.deepEqual(
        await copyReadyCaseAnalyses({ sourceCaseId: source.id, targetCaseId: copy.id }, query),
        []
    );

    await insertRequestedCaseAnalyses(
        { caseId: source.id, serviceIds: [`svc-case-${randomUUID()}`], userId: authorId },
        query
    );
    assert.deepEqual(
        await copyReadyCaseAnalyses({ sourceCaseId: source.id, targetCaseId: copy.id }, query),
        []
    );
    assert.deepEqual(await listCaseAnalyses(copy.id, query), []);
});

test("case analyses: the copy reserves the allowed services it did not inherit, as the copying teacher", { skip: SKIP_REASON }, async () => {
    const { source, services } = await createSourceWithAnalyses();
    const copierId = await createTeacher();
    const copy = await createCase(copierId);
    await copyReadyCaseAnalyses({ sourceCaseId: source.id, targetCaseId: copy.id }, query);

    const dispatched = [];
    await requestCaseCopyAnalyses({
        sourceCaseId:   source.id,
        copiedCase:     copy,
        userId:         copierId,
        pdfRenderJobId: null,
    }, {
        registry: {
            initialize:                  async () => {},
            // The policy no longer allows the never-started service.
            getUsableServiceIdsForScope: async () => Object.values(services)
                .filter(serviceId => serviceId !== services.requested),
        },
        listAnalyses:    caseId => listCaseAnalyses(caseId, query),
        insertRequested: args => insertRequestedCaseAnalyses(args, query),
        dispatch:        async (context, { reservations }) => {
            dispatched.push({ context, reservations });
            return [];
        },
    });

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].context.caseId, copy.id);
    assert.deepEqual(
        dispatched[0].reservations.map(row => row.service_id).sort(),
        [services.failed, services.inFlight].sort()
    );

    for (const serviceId of [services.failed, services.inFlight]) {
        const row = await getCaseAnalysis({ caseId: copy.id, serviceId }, query);
        assert.equal(row.status, "requested", serviceId);
        assert.equal(row.requested_by, copierId);
        assert.equal(row.document, null, "the copy starts its own generation");
        assert.ok(row.job_id);
    }
    assert.equal(await getCaseAnalysis({ caseId: copy.id, serviceId: services.requested }, query), null);

    // The inherited analyses are untouched.
    const copyReady = await getCaseAnalysis({ caseId: copy.id, serviceId: services.ready }, query);
    assert.equal(copyReady.status, "ready");
    assert.equal(copyReady.job_id, null);
});

test("case analyses: generating an inherited analysis again changes the copy, never the source", { skip: SKIP_REASON }, async () => {
    const { authorId, source, services } = await createSourceWithAnalyses();
    const copierId = await createTeacher();
    const copy = await createCase(copierId);
    await copyReadyCaseAnalyses({ sourceCaseId: source.id, targetCaseId: copy.id }, query);

    const ids = { caseId: copy.id, serviceId: services.ready };
    const reservation = await reserveCaseAnalysisGeneration(ids, query);
    assert.ok(reservation, "an inherited analysis can be generated again");
    await markCaseAnalysisProcessing({ ...ids, jobId: reservation.job_id }, query);
    await completeCaseAnalysis({
        serviceId:      services.ready,
        jobId:          reservation.job_id,
        documentSchema: "evidence-inventory/v1",
        document:       { version: 2 },
    }, query);

    assert.deepEqual((await getCaseAnalysis(ids, query)).document, { version: 2 });
    const sourceRow = await getCaseAnalysis({ caseId: source.id, serviceId: services.ready }, query);
    assert.deepEqual(sourceRow.document, { version: 1 });
    assert.equal(sourceRow.requested_by, authorId);

    // Deleting the copy deletes only its analyses.
    await dbQuery("DELETE FROM ethical_cases WHERE id = $1;", [copy.id]);
    assert.deepEqual(await listCaseAnalyses(copy.id, query), []);
    assert.equal((await listCaseAnalyses(source.id, query)).length, Object.keys(services).length);
});

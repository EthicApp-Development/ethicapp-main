// The render of a copied case (#1088). Importing a case from Casos
// (POST /cases/:id/import), duplicating one's own case
// (POST /cases/:id/duplicate) and importing a design, which copies its case
// (POST /designs/:id/duplicate), follow one rule: once the copy is committed,
// it gets a render job when it has a PDF path and no job yet, even when its PDF
// file could not be copied and it kept the source's path. The case routes wait
// for the job and answer with it; the design import queues it after the
// answer.
//
// The source's PDF path names a file that does not exist, so copying the file
// fails, as when the uploads volume is missing it. The uploads directory is a
// temporary one, removed afterwards, since the copy creates the destination's
// directory before it fails. PostgreSQL is a fake pg pool and the render and
// analysis requests are fakes, so nothing here needs a database or the
// network.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";

import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";
import { insertedRow } from "./inserted-row.mjs";

// The controllers read UPLOADS_PATH when they are loaded.
const uploadsDirectory = mkdtempSync(path.join(tmpdir(), "case-copy-render-"));
process.env.UPLOADS_PATH = uploadsDirectory;
const { default: casesRouter, caseCopyServices } = await import("../cases.js");
const { default: designsRouter, designCaseCopyServices } = await import("../designs.js");
const { ensureCasePdfRenderJob } = await import("../../helpers/pdf-render-jobs-helper.js");

const AUTHOR_ID = 7;
const IMPORTER_ID = 8;
const DESIGN_ID = 12;
const CASE_ID = 41;
const COPY_CASE_ID = 99;
const EXISTING_COPY_CASE_ID = 55;
const COPY_DESIGN_ID = 500;
const RENDER_JOB_ID = 301;
const COPY_CASE_UUID = "0f1e2d3c-0000-4000-8000-000000000099";
const MISSING_SOURCE_PDF = `/uploads/cases/${CASE_ID}/missing-1088-test.pdf`;

const state = { existingCaseCopy: false, renderJob: null };

function sourceCaseRow() {
    return {
        id:               CASE_ID,
        title:            "A case",
        author_firstname: "Ada",
        author_lastname:  "Lovelace",
        author_email:     "ada@example.org",
        pdf_path:         MISSING_SOURCE_PDF,
        creator:          AUTHOR_ID,
        visibility:       "public",
        archived:         false,
        license_code:     "CC-BY-4.0",
        attribution_text: null,
        original_case_id: null,
        language_code:    "en_US",
    };
}

// copyCaseForUser's look-up of the teacher's existing copy of the case.
const EXISTING_COPY_SQL = new RegExp(
    String.raw`SELECT id\s+FROM ethical_cases\s+WHERE creator = \$1\s+`
    + String.raw`AND \(id = \$2 OR original_case_id = \$3\)`,
    "u"
);

// ensureCasePdfRenderJob's look-up of the case's PDF path and render job.
const RENDER_LOOKUP_SQL = /SELECT c\.pdf_path, prj\.id AS pdf_render_job_id/u;

function rowsFor(sql) {
    if (/FROM designs d\s+LEFT JOIN ethical_cases c[\s\S]*LEFT JOIN users u/u.test(sql)) {
        return [{
            id:         DESIGN_ID,
            creator:    AUTHOR_ID,
            visibility: "public",
            archived:   false,
            design:     { metainfo: { title: "A design" }, phases: [] },
            case_id:    CASE_ID,
        }];
    }
    if (/SELECT id, title, author_firstname[\s\S]*FROM ethical_cases\s+WHERE id = \$1/u.test(sql)) {
        return [sourceCaseRow()];
    }
    if (EXISTING_COPY_SQL.test(sql)) {
        return state.existingCaseCopy ? [{ id: EXISTING_COPY_CASE_ID }] : [];
    }
    if (/SELECT nextval/u.test(sql)) {
        return [{ id: COPY_CASE_ID }];
    }
    if (/^\s*INSERT INTO ethical_cases\s*\(/u.test(sql)) {
        return [{
            id:         COPY_CASE_ID,
            case_uuid:  COPY_CASE_UUID,
            title:      "A case",
            pdf_path:   MISSING_SOURCE_PDF,
            visibility: "private",
        }];
    }
    if (/^\s*INSERT INTO designs\s*\(/u.test(sql)) {
        return [{ id: COPY_DESIGN_ID }];
    }
    if (RENDER_LOOKUP_SQL.test(sql)) {
        return [state.renderJob];
    }
    // The case routes read the copy back for their answer.
    if (/FROM ethical_cases c[\s\S]*WHERE c\.id = \$1/u.test(sql)) {
        return [{
            id:                COPY_CASE_ID,
            case_uuid:         COPY_CASE_UUID,
            title:             "A case (copy)",
            pdf_path:          MISSING_SOURCE_PDF,
            creator:           IMPORTER_ID,
            visibility:        "private",
            pdf_render_job_id: null,
        }];
    }
    return [];
}

function queuedJob(caseId) {
    return {
        pdf_render_job_id:      RENDER_JOB_ID,
        pdf_render_owner_type:  "case",
        pdf_render_owner_id:    caseId,
        pdf_render_source_path: MISSING_SOURCE_PDF,
        pdf_render_status:      "pending",
        pdf_render_page_count:  null,
    };
}

const db = installFakePgPool(rowsFor);
const originals = {
    caseRender:     caseCopyServices.ensureRenderJob,
    caseAnalyses:   caseCopyServices.requestCopyAnalyses,
    designRender:   designCaseCopyServices.ensureRenderJob,
    designAnalyses: designCaseCopyServices.requestCopyAnalyses,
};
let renderCalls = [];
let analysisRequests = [];

async function fakeEnsureRenderJob(caseId, options) {
    renderCalls.push({ caseId, options });
    return queuedJob(caseId);
}

async function fakeRequestCopyAnalyses(args) {
    analysisRequests.push(args);
    return [];
}

after(() => {
    db.restore();
    rmSync(uploadsDirectory, { recursive: true, force: true });
});

beforeEach(() => {
    db.reset();
    state.existingCaseCopy = false;
    state.renderJob = null;
    renderCalls = [];
    analysisRequests = [];
    caseCopyServices.ensureRenderJob = fakeEnsureRenderJob;
    caseCopyServices.requestCopyAnalyses = fakeRequestCopyAnalyses;
    designCaseCopyServices.ensureRenderJob = fakeEnsureRenderJob;
    designCaseCopyServices.requestCopyAnalyses = fakeRequestCopyAnalyses;
});

afterEach(() => {
    caseCopyServices.ensureRenderJob = originals.caseRender;
    caseCopyServices.requestCopyAnalyses = originals.caseAnalyses;
    designCaseCopyServices.ensureRenderJob = originals.designRender;
    designCaseCopyServices.requestCopyAnalyses = originals.designAnalyses;
});

// The follow-ups run after the answer, on a later turn of the event loop.
async function settle(condition) {
    for (let attempt = 0; attempt < 20 && !condition(); attempt += 1) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

function caseCopyInserts() {
    return db.queries
        .filter(query => /^\s*INSERT INTO ethical_cases\s*\(/u.test(query.sql))
        .map(query => insertedRow(query.sql, query.params));
}

const importCase = () => requestRouter(casesRouter, {
    method:  "POST",
    path:    `/cases/${CASE_ID}/import`,
    session: { uid: IMPORTER_ID, role: "P" },
});

const duplicateCase = () => requestRouter(casesRouter, {
    method:  "POST",
    path:    `/cases/${CASE_ID}/duplicate`,
    session: { uid: AUTHOR_ID, role: "P" },
});

const importDesign = () => requestRouter(designsRouter, {
    method:  "POST",
    path:    `/designs/${DESIGN_ID}/duplicate`,
    session: { uid: IMPORTER_ID, role: "P" },
});

describe("a case copied from Casos when its PDF file cannot be copied (#1088)", () => {
    for (const [route, copy, reason] of [
        ["an import", importCase, "case_imported"],
        ["a duplicate", duplicateCase, "case_duplicated"],
    ]) {
        it(`${route} keeps the source's PDF path and still gets one render job`, async () => {
            const { status, body } = await copy();

            assert.equal(status, 201);
            const [inserted] = caseCopyInserts();
            assert.equal(inserted.pdf_path, MISSING_SOURCE_PDF, "the file copy failed");
            assert.deepEqual(renderCalls, [{
                caseId:  COPY_CASE_ID,
                options: { metadata: { reason, caseUuid: COPY_CASE_UUID } },
            }]);
            const { documentProcessing } = body.result;
            assert.equal(documentProcessing.id, RENDER_JOB_ID, "the answer carries the job");
            assert.equal(documentProcessing.status, "pending");
        });

        it(`${route} requests the copy's analyses with that job`, async () => {
            await copy();
            await settle(() => analysisRequests.length > 0);

            assert.equal(analysisRequests.length, 1);
            assert.equal(analysisRequests[0].pdfRenderJobId, RENDER_JOB_ID);
        });

        it(`${route} is not failed by a render that cannot be queued`, async () => {
            caseCopyServices.ensureRenderJob = async (caseId, options) => {
                renderCalls.push({ caseId, options });
                throw new Error("queue unavailable");
            };

            const { status, body } = await copy();
            await settle(() => analysisRequests.length > 0);

            assert.equal(status, 201);
            assert.equal(renderCalls.length, 1);
            assert.equal(body.result.documentProcessing, null);
            assert.equal(analysisRequests[0].pdfRenderJobId, null);
        });
    }
});

describe("a case copied by a design import (#1088)", () => {
    it("gets one render job after the answer, as a copy from Casos does", async () => {
        const { status, body } = await importDesign();
        await settle(() => analysisRequests.length > 0);

        assert.equal(status, 200);
        assert.equal(body.caseId, COPY_CASE_ID);
        const [inserted] = caseCopyInserts();
        assert.equal(inserted.pdf_path, MISSING_SOURCE_PDF, "the file copy failed");
        assert.deepEqual(renderCalls, [{
            caseId:  COPY_CASE_ID,
            options: { metadata: { reason: "design_copied" } },
        }]);
        assert.equal(analysisRequests.length, 1);
        assert.equal(analysisRequests[0].pdfRenderJobId, RENDER_JOB_ID);
    });

    it("checks a reused copy's render, and requests no analyses for it", async () => {
        state.existingCaseCopy = true;

        const { status, body } = await importDesign();
        await settle(() => renderCalls.length > 0);

        assert.equal(status, 200);
        assert.equal(body.caseId, EXISTING_COPY_CASE_ID);
        assert.deepEqual(caseCopyInserts(), []);
        assert.deepEqual(renderCalls.map(call => call.caseId), [EXISTING_COPY_CASE_ID]);
        assert.deepEqual(analysisRequests, []);
    });
});

describe("ensureCasePdfRenderJob, the rule the three copy paths share (#1088)", () => {
    const renderJobWrites = () => db.queries
        .filter(query => /INSERT INTO pdf_render_jobs/u.test(query.sql));

    it("queues nothing for a case that already has a render job", async () => {
        state.renderJob = { pdf_path: MISSING_SOURCE_PDF, pdf_render_job_id: 17 };

        assert.equal(await ensureCasePdfRenderJob(EXISTING_COPY_CASE_ID), null);
        assert.deepEqual(renderJobWrites(), []);
    });

    it("queues nothing for a case without a PDF", async () => {
        state.renderJob = { pdf_path: null, pdf_render_job_id: null };

        assert.equal(await ensureCasePdfRenderJob(COPY_CASE_ID), null);
        assert.deepEqual(renderJobWrites(), []);
    });
});

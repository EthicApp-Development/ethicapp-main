import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

import caseAnalysesRouter, {
    generateCaseAnalysisForOwner,
    getCaseAnalysisForOwner,
    listCaseAnalysesForOwner,
    saveCaseAnalysisForOwner,
} from "../case-analyses.js";

const OWNER_ID = 3;
const OTHER_TEACHER_ID = 99;

const CASE_ROW = {
    id:                7,
    creator:           OWNER_ID,
    language_code:     "en",
    pdf_render_job_id: 11,
};

const READY_ROW = {
    service_id:      "svc-ready",
    status:          "ready",
    is_stale:        false,
    document_schema: "check/v1",
    document:        { words: 12 },
    error_code:      null,
    error_message:   null,
    requested_at:    "2026-10-22T10:00:00.000Z",
    generated_at:    "2026-10-22T10:05:00.000Z",
    reviewed_at:     null,
    updated_at:      "2026-10-22T10:05:00.000Z",
};
const BUSY_ROW      = { ...READY_ROW, service_id: "svc-busy", status: "processing" };
const STALE_ROW     = { ...BUSY_ROW, service_id: "svc-stale", is_stale: true };
const REQUESTED_ROW = { ...READY_ROW, service_id: "svc-new", status: "requested", document: null };

function makeDependencies(overrides = {}) {
    const calls = { saveReviewed: [], dispatchGeneration: [] };
    const rows = [READY_ROW, BUSY_ROW, STALE_ROW, REQUESTED_ROW];
    const findRow = serviceId => rows.find(row => row.service_id === serviceId) ?? null;

    const saveReviewed = async args => {
        calls.saveReviewed.push(args);
        return { ...READY_ROW, service_id: args.serviceId, document_schema: args.documentSchema };
    };
    const dispatchGeneration = (caseRow, serviceId) => {
        calls.dispatchGeneration.push({ caseRow, serviceId });
    };

    const dependencies = {
        getOwnedCase:     async (caseId, userId) => (userId === OWNER_ID ? CASE_ROW : null),
        listAnalyses:     async () => rows,
        getAnalysis:      async ({ serviceId }) => findRow(serviceId),
        getValidator:     async () => null,
        isServiceEnabled: async () => true,
        getCaseText:      async () => "The case text.",
        saveReviewed,
        dispatchGeneration,
        ...overrides,
    };

    return { dependencies, calls };
}

// ─── reads ───────────────────────────────────────────────────────────────────

test("listCaseAnalysesForOwner: lists the chosen services without documents", async () => {
    const { dependencies } = makeDependencies();

    const { status, body } = await listCaseAnalysesForOwner({
        caseId: 7,
        userId: OWNER_ID,
        dependencies,
    });

    assert.equal(status, 200);
    assert.deepEqual(body.result.map(({ serviceId }) => serviceId), [
        "svc-ready", "svc-busy", "svc-stale", "svc-new",
    ]);
    assert.deepEqual(body.result[0], {
        serviceId:      "svc-ready",
        status:         "ready",
        stale:          false,
        documentSchema: "check/v1",
        errorCode:      null,
        errorMessage:   null,
        requestedAt:    "2026-10-22T10:00:00.000Z",
        generatedAt:    "2026-10-22T10:05:00.000Z",
        reviewedAt:     null,
        updatedAt:      "2026-10-22T10:05:00.000Z",
    });
});

test("listCaseAnalysesForOwner: 404 for a case of another teacher", async () => {
    const { dependencies } = makeDependencies();

    const { status, body } = await listCaseAnalysesForOwner({
        caseId: 7,
        userId: OTHER_TEACHER_ID,
        dependencies,
    });

    assert.equal(status, 404);
    assert.equal(body.code, "CASE_NOT_FOUND");
});

test("getCaseAnalysisForOwner: returns one analysis with its document", async () => {
    const { dependencies } = makeDependencies();

    const { status, body } = await getCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 200);
    assert.deepEqual(body.result.document, { words: 12 });
});

test("getCaseAnalysisForOwner: 404 when the service was not chosen for the case", async () => {
    const { dependencies } = makeDependencies();

    const { status, body } = await getCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-other",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 404);
    assert.equal(body.code, "CASE_ANALYSIS_NOT_FOUND");
});

// ─── teacher edits ───────────────────────────────────────────────────────────

test("saveCaseAnalysisForOwner: 405 when the service has no validator", async () => {
    const { dependencies, calls } = makeDependencies();

    const { status, body } = await saveCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        document:  { words: 13 },
        dependencies,
    });

    assert.equal(status, 405);
    assert.equal(body.code, "CASE_ANALYSIS_NOT_EDITABLE");
    assert.equal(calls.saveReviewed.length, 0);
});

test("saveCaseAnalysisForOwner: stores the document and schema from the validator", async () => {
    const validatorCalls = [];
    const { dependencies, calls } = makeDependencies({
        getValidator: async () => async (document, context) => {
            validatorCalls.push({ document, context, caseText: await context.getCaseText() });
            return { document: { words: 13, normalized: true }, documentSchema: "check/v2" };
        },
    });

    const { status, body } = await saveCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        document:  { words: 13 },
        dependencies,
    });

    assert.equal(status, 200);
    assert.deepEqual(body.result.document, { words: 13, normalized: true });
    assert.deepEqual(validatorCalls[0].document, { words: 13 });
    assert.equal(validatorCalls[0].context.caseId, 7);
    assert.equal(validatorCalls[0].context.languageCode, "en");
    assert.equal(validatorCalls[0].caseText, "The case text.");
    assert.deepEqual(calls.saveReviewed, [{
        caseId:         7,
        serviceId:      "svc-ready",
        documentSchema: "check/v2",
        document:       { words: 13, normalized: true },
        userId:         OWNER_ID,
    }]);
});

test("saveCaseAnalysisForOwner: 400 with the validator's errors, without saving", async () => {
    const { dependencies, calls } = makeDependencies({
        getValidator: async () => async () => ({ errors: ["EV1: quote not found"] }),
    });

    const { status, body } = await saveCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        document:  { words: -1 },
        dependencies,
    });

    assert.equal(status, 400);
    assert.equal(body.code, "CASE_ANALYSIS_DOCUMENT_INVALID");
    assert.deepEqual(body.details, ["EV1: quote not found"]);
    assert.equal(calls.saveReviewed.length, 0);
});

test("saveCaseAnalysisForOwner: 409 when the save is refused during a generation", async () => {
    const { dependencies } = makeDependencies({
        getValidator: async () => async document => ({ document }),
        saveReviewed: async () => null,
    });

    const { status, body } = await saveCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-busy",
        userId:    OWNER_ID,
        document:  { words: 13 },
        dependencies,
    });

    assert.equal(status, 409);
    assert.equal(body.code, "CASE_ANALYSIS_PROCESSING");
});

// ─── generation ──────────────────────────────────────────────────────────────

test("generateCaseAnalysisForOwner: dispatches requested and stale analyses", async () => {
    const { dependencies, calls } = makeDependencies();

    for (const serviceId of ["svc-new", "svc-stale"]) {
        const { status } = await generateCaseAnalysisForOwner({
            caseId: 7,
            serviceId,
            userId: OWNER_ID,
            dependencies,
        });

        assert.equal(status, 202, serviceId);
    }

    assert.deepEqual(calls.dispatchGeneration, [
        { caseRow: CASE_ROW, serviceId: "svc-new" },
        { caseRow: CASE_ROW, serviceId: "svc-stale" },
    ]);
});

test("generateCaseAnalysisForOwner: 409 while a fresh generation runs", async () => {
    const { dependencies, calls } = makeDependencies();

    const { status, body } = await generateCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-busy",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 409);
    assert.equal(body.code, "CASE_ANALYSIS_PROCESSING");
    assert.equal(calls.dispatchGeneration.length, 0);
});

test("generateCaseAnalysisForOwner: 503 when the service is disabled", async () => {
    const { dependencies, calls } = makeDependencies({ isServiceEnabled: async () => false });

    const { status, body } = await generateCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-new",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 503);
    assert.equal(body.code, "CASE_ANALYSIS_SERVICE_DISABLED");
    assert.equal(calls.dispatchGeneration.length, 0);
});

test("generateCaseAnalysisForOwner: 404 for unchosen services and cases of others", async () => {
    const { dependencies, calls } = makeDependencies();

    const unchosen = await generateCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-other",
        userId:    OWNER_ID,
        dependencies,
    });
    const otherTeacher = await generateCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-new",
        userId:    OTHER_TEACHER_ID,
        dependencies,
    });

    assert.equal(unchosen.body.code, "CASE_ANALYSIS_NOT_FOUND");
    assert.equal(otherTeacher.body.code, "CASE_NOT_FOUND");
    assert.equal(calls.dispatchGeneration.length, 0);
});

// ─── routes ──────────────────────────────────────────────────────────────────

// Sends one request to the router in an in-memory app with the given session.
async function requestStatus({ role, method, path }) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = { uid: OWNER_ID, role };
        next();
    });
    app.use(caseAnalysesRouter);

    const server = createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
            method,
            headers: { "Content-Type": "application/json" },
            body:    method === "PUT" ? JSON.stringify({ document: {} }) : undefined,
        });
        return response.status;
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test("routes: students get 403 and invalid case ids 400, before any lookup", async () => {
    const routes = [
        ["GET", "/cases/7/analyses"],
        ["GET", "/cases/7/analyses/svc-ready"],
        ["PUT", "/cases/7/analyses/svc-ready"],
        ["POST", "/cases/7/analyses/svc-ready/generate"],
    ];

    for (const [method, path] of routes) {
        assert.equal(await requestStatus({ role: "A", method, path }), 403, `${method} ${path}`);
    }

    const invalidCaseId = { role: "P", method: "GET", path: "/cases/abc/analyses" };
    assert.equal(await requestStatus(invalidCaseId), 400);
});

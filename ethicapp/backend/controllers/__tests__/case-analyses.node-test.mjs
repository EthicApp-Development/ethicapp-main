import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

import caseAnalysesRouter, {
    createCaseAnalysesRouter,
    describeServices,
    generateCaseAnalysisForOwner,
    getCaseAnalysisForOwner,
    listCaseAnalysesForOwner,
    saveCaseAnalysisForOwner,
} from "../case-analyses.js";

const OWNER_ID = 3;
const OTHER_TEACHER_ID = 99;
const JOB_ID = "a7b8c9d0-0000-4000-8000-000000000061";

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

// The condition of reserveCaseAnalysisGeneration() and saveReviewedCaseAnalysis().
const isInFlight = row => ["requested", "processing"].includes(row.status) && !row.is_stale;

function makeDependencies(overrides = {}) {
    const calls = { saveReviewed: [], reserveGeneration: [], dispatchGeneration: [] };
    const rows = [READY_ROW, BUSY_ROW, STALE_ROW, REQUESTED_ROW];
    const findRow = serviceId => rows.find(row => row.service_id === serviceId) ?? null;

    const saveReviewed = async args => {
        calls.saveReviewed.push(args);
        return { ...READY_ROW, service_id: args.serviceId, document_schema: args.documentSchema };
    };
    const reserveGeneration = async ({ serviceId }) => {
        calls.reserveGeneration.push(serviceId);
        const row = findRow(serviceId);
        return row && !isInFlight(row) ? { ...row, status: "requested", job_id: JOB_ID } : null;
    };
    const dispatchGeneration = (caseRow, reservation) => {
        calls.dispatchGeneration.push({ caseRow, reservation });
    };

    const dependencies = {
        getOwnedCase:    async (caseId, userId) => (userId === OWNER_ID ? CASE_ROW : null),
        listAnalyses:    async () => rows,
        getAnalysis:     async ({ serviceId }) => findRow(serviceId),
        getValidator:    async () => null,
        isServiceUsable: async () => true,
        getCaseText:     async () => "The case text.",
        saveReviewed,
        reserveGeneration,
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
        ui:             { component: null, translations: null },
        usable:         false,
    });
});

test("listCaseAnalysesForOwner: adds each service's UI metadata and usability", async () => {
    const translations = {
        es_CL: { label: "Revisión", description: "Revisa el caso.", tabTitle: "Revisión" },
        en_US: { label: "Check", description: "Checks the case.", tabTitle: "Check" },
    };
    const described = [];
    const { dependencies } = makeDependencies({
        describeServices: async (serviceIds) => {
            described.push(serviceIds);
            return new Map([
                ["svc-ready", { ui: { component: "check-view", translations }, usable: true }],
            ]);
        },
    });

    const { status, body } = await listCaseAnalysesForOwner({
        caseId: 7,
        userId: OWNER_ID,
        dependencies,
    });

    assert.equal(status, 200);
    assert.deepEqual(described, [["svc-ready", "svc-busy", "svc-stale", "svc-new"]]);
    assert.deepEqual(body.result[0].ui, { component: "check-view", translations });
    assert.equal(body.result[0].usable, true);
    // Services without a description fall back to no component, no texts and not usable.
    assert.deepEqual(body.result[1].ui, { component: null, translations: null });
    assert.equal(body.result[1].usable, false);
});

test("listCaseAnalysesForOwner: lists the analyses when describing services fails", async () => {
    const { dependencies } = makeDependencies({
        describeServices: async () => {
            throw new Error("registry unavailable");
        },
    });

    const originalWarn = console.warn;
    console.warn = () => {};
    let response;
    try {
        response = await listCaseAnalysesForOwner({ caseId: 7, userId: OWNER_ID, dependencies });
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(response.status, 200);
    assert.equal(response.body.result.length, 4);
    assert.ok(response.body.result.every(analysis => analysis.ui.component === null
        && analysis.usable === false));
});

test("listCaseAnalysesForOwner: does not describe services when none was chosen", async () => {
    let describeCalls = 0;
    const { dependencies } = makeDependencies({
        listAnalyses:     async () => [],
        describeServices: async () => {
            describeCalls += 1;
            return new Map();
        },
    });

    const { status, body } = await listCaseAnalysesForOwner({
        caseId: 7,
        userId: OWNER_ID,
        dependencies,
    });

    assert.equal(status, 200);
    assert.deepEqual(body.result, []);
    assert.equal(describeCalls, 0);
});

test("describeServices: reads component, UI texts and usability from the registry", async () => {
    const translations = {
        es_CL: { label: "Prueba", description: "Prueba.", tabTitle: "Prueba" },
        en_US: { label: "Mock", description: "Mock.", tabTitle: "Mock" },
    };
    const services = { "svc-mock": { ui: { component: "mock-view" } } };
    const registry = {
        initialize:               async () => {},
        usableServiceIds:         async ids => ids.filter(id => id === "svc-mock"),
        getServiceById:           id => services[id] ?? null,
        getServiceUiTranslations: async id => (id === "svc-mock" ? translations : null),
    };

    const descriptions = await describeServices(["svc-mock", "svc-unknown"], registry);

    assert.deepEqual(descriptions.get("svc-mock"), {
        ui:     { component: "mock-view", translations },
        usable: true,
    });
    assert.deepEqual(descriptions.get("svc-unknown"), {
        ui:     { component: null, translations: null },
        usable: false,
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

test("generateCaseAnalysisForOwner: dispatches settled and stale analyses, reserved", async () => {
    const { dependencies, calls } = makeDependencies();

    for (const serviceId of ["svc-ready", "svc-stale"]) {
        const { status, body } = await generateCaseAnalysisForOwner({
            caseId: 7,
            serviceId,
            userId: OWNER_ID,
            dependencies,
        });

        assert.equal(status, 202, serviceId);
        assert.equal(body.result.status, "requested", serviceId);
    }

    assert.deepEqual(
        calls.dispatchGeneration.map(({ caseRow, reservation }) => [
            caseRow, reservation.service_id, reservation.job_id,
        ]),
        [[CASE_ROW, "svc-ready", JOB_ID], [CASE_ROW, "svc-stale", JOB_ID]]
    );
});

test("generateCaseAnalysisForOwner: 409 when the reservation is refused", async () => {
    const { dependencies, calls } = makeDependencies();

    for (const serviceId of ["svc-busy", "svc-new"]) {
        const { status, body } = await generateCaseAnalysisForOwner({
            caseId: 7,
            serviceId,
            userId: OWNER_ID,
            dependencies,
        });

        assert.equal(status, 409, serviceId);
        assert.equal(body.code, "CASE_ANALYSIS_PROCESSING", serviceId);
    }

    assert.deepEqual(calls.reserveGeneration, ["svc-busy", "svc-new"]);
    assert.equal(calls.dispatchGeneration.length, 0);
});

test("generateCaseAnalysisForOwner: 503 when the service is disabled", async () => {
    const { dependencies, calls } = makeDependencies({ isServiceUsable: async () => false });

    const { status, body } = await generateCaseAnalysisForOwner({
        caseId:    7,
        serviceId: "svc-new",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 503);
    assert.equal(body.code, "CASE_ANALYSIS_SERVICE_DISABLED");
    assert.equal(calls.reserveGeneration.length, 0);
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
    assert.equal(calls.reserveGeneration.length, 0);
    assert.equal(calls.dispatchGeneration.length, 0);
});

// ─── routes ──────────────────────────────────────────────────────────────────

// Serves the router in an in-memory app whose requests carry the given role.
async function serve(router, { role }) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = { uid: OWNER_ID, role };
        next();
    });
    app.use(router);

    const server = createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    return {
        async request(method, path, body) {
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers: { "Content-Type": "application/json" },
                body:    body === undefined ? undefined : JSON.stringify(body),
            });
            return { status: response.status, body: await response.json() };
        },
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

test("routes: students get 403 and invalid case ids 400, before any lookup", async () => {
    const routes = [
        ["GET", "/cases/7/analyses"],
        ["GET", "/cases/7/analyses/svc-ready"],
        ["PUT", "/cases/7/analyses/svc-ready", { document: {} }],
        ["POST", "/cases/7/analyses/svc-ready/generate"],
    ];

    const student = await serve(caseAnalysesRouter, { role: "A" });
    const teacher = await serve(caseAnalysesRouter, { role: "P" });
    try {
        for (const [method, path, body] of routes) {
            const { status } = await student.request(method, path, body);
            assert.equal(status, 403, `${method} ${path}`);
        }

        assert.equal((await teacher.request("GET", "/cases/abc/analyses")).status, 400);
    } finally {
        await student.close();
        await teacher.close();
    }
});

// In-memory case_analyses rows updated under the conditions of the helper's
// SQL. Each call yields first, like a query round trip; each conditional
// update then checks and writes without yielding, as one UPDATE does under
// its row lock.
function makeAnalysisTable(initialRows) {
    const rows = new Map(initialRows.map(row => [row.service_id, { ...row }]));
    const roundTrip = () => new Promise(resolve => setImmediate(resolve));
    let jobCount = 0;

    async function update(serviceId, condition, changes) {
        await roundTrip();
        const row = rows.get(serviceId);
        if (!row || !condition(row)) {
            return null;
        }
        Object.assign(row, changes(), { is_stale: false });
        return { ...row };
    }

    return {
        rows,
        async getAnalysis({ serviceId }) {
            await roundTrip();
            return rows.has(serviceId) ? { ...rows.get(serviceId) } : null;
        },
        reserveGeneration: ({ serviceId }) => update(serviceId, row => !isInFlight(row), () => ({
            status: "requested",
            job_id: `job-${++jobCount}`,
        })),
        saveReviewed: ({ serviceId, documentSchema, document, userId }) => update(
            serviceId,
            row => !isInFlight(row),
            () => ({
                status:          "ready",
                document_schema: documentSchema,
                document,
                job_id:          null,
                reviewed_by:     userId,
            })
        ),
        // What the adapter of the reserved service calls through caseAnalyses.
        markProcessing: ({ serviceId, jobId }) => update(
            serviceId,
            row => row.job_id === jobId && row.status === "requested",
            () => ({ status: "processing" })
        ),
        complete: ({ serviceId, jobId, document }) => update(
            serviceId,
            row => row.job_id === jobId && row.status === "processing",
            () => ({ status: "ready", document, reviewed_by: null })
        ),
    };
}

// Serves the router over the table; dispatched generations are only recorded,
// so each test decides when their adapter starts.
async function serveOverTable(table) {
    const dispatched = [];
    const { dependencies } = makeDependencies({
        getAnalysis:        table.getAnalysis,
        reserveGeneration:  table.reserveGeneration,
        saveReviewed:       table.saveReviewed,
        getValidator:       async () => async document => ({ document }),
        dispatchGeneration: (caseRow, reservation) => { dispatched.push(reservation); },
    });

    const app = await serve(createCaseAnalysesRouter(dependencies), { role: "P" });
    return { app, dispatched };
}

test("routes: of two concurrent generate requests one gets 202 and one 409", async () => {
    const table = makeAnalysisTable([READY_ROW]);
    const { app, dispatched } = await serveOverTable(table);

    try {
        const responses = await Promise.all([1, 2].map(() =>
            app.request("POST", "/cases/7/analyses/svc-ready/generate")
        ));

        assert.deepEqual(responses.map(({ status }) => status).sort(), [202, 409]);
        assert.equal(dispatched.length, 1, "a single generation is dispatched");
        assert.equal(dispatched[0].job_id, table.rows.get("svc-ready").job_id);
    } finally {
        await app.close();
    }
});

test("routes: an edit is refused once a generation is accepted, and kept after it", async () => {
    const table = makeAnalysisTable([READY_ROW]);
    const { app, dispatched } = await serveOverTable(table);
    const path = "/cases/7/analyses/svc-ready";
    const edit = { document: { words: 99 } };

    try {
        assert.equal((await app.request("POST", `${path}/generate`)).status, 202);

        // The adapter has not started yet: the edit must not be accepted.
        const refused = await app.request("PUT", path, edit);
        assert.equal(refused.status, 409);
        assert.equal(refused.body.code, "CASE_ANALYSIS_PROCESSING");

        const generation = { serviceId: "svc-ready", jobId: dispatched[0].job_id };
        assert.ok(await table.markProcessing(generation));
        assert.ok(await table.complete({ ...generation, document: { words: 20 } }));

        assert.equal((await app.request("PUT", path, edit)).status, 200);

        // A delayed replay of the same job can neither start nor replace the edit.
        assert.equal(await table.markProcessing(generation), null);
        assert.equal(await table.complete({ ...generation, document: { words: 20 } }), null);
        assert.deepEqual(table.rows.get("svc-ready").document, { words: 99 });
        assert.equal(table.rows.get("svc-ready").reviewed_by, OWNER_ID);
    } finally {
        await app.close();
    }
});

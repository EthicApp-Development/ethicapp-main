import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

import designAnalysesRouter, {
    createDesignAnalysesRouter,
    generateDesignAnalysisForOwner,
    getDesignAnalysisForOwner,
    listDesignAnalysesForOwner,
    saveDesignAnalysisForOwner,
} from "../design-analyses.js";

const OWNER_ID = 3;
const OTHER_TEACHER_ID = 99;
const JOB_ID = "c3d4e5f6-0000-4000-8000-000000000081";

const DESIGN_ROW = {
    id:                 5,
    creator:            OWNER_ID,
    locked:             false,
    case_id:            42,
    case_language_code: "es",
    design:             { phases: [] },
    design_fingerprint: "fingerprint-1",
};
// The design snapshot its reservations are bound to.
const DESIGN_SNAPSHOT = { fingerprint: "fingerprint-1", caseId: 42 };
const LOCKED_DESIGN_ROW = { ...DESIGN_ROW, locked: true };

const READY_ROW = {
    service_id:      "svc-ready",
    status:          "ready",
    is_stale:        false,
    document_schema: "claim-typology/v1",
    document:        { typologies: [] },
    input_hash:      "sha256:abc",
    error_code:      null,
    error_message:   null,
    requested_at:    "2026-10-27T10:00:00.000Z",
    generated_at:    "2026-10-27T10:05:00.000Z",
    reviewed_at:     null,
    updated_at:      "2026-10-27T10:05:00.000Z",
};
const BUSY_ROW  = { ...READY_ROW, service_id: "svc-busy", status: "processing" };
const STALE_ROW = { ...BUSY_ROW, service_id: "svc-stale", is_stale: true };

// Services registered with the `design` scope; "svc-new" has no row yet.
const DESIGN_SERVICES = ["svc-ready", "svc-busy", "svc-stale", "svc-new"];

// What describeDesignAnalysisUnits() returns for DESIGN_ROW (#865).
const UNIT = Object.freeze({
    id: "p1-q1", phaseNumber: 1, questionNumber: 1, text: "Why?", textHash: "sha256:why",
});
const SELECTION = Object.freeze({
    units:       [UNIT],
    unitsReason: null,
    tutorModes:  { "p1-q1": { mode: "basic", reason: "no-inventory", requestedMode: "enhanced" } },
    tutorPhases: [
        { phaseNumber: 1, requestedMode: "enhanced", reason: null },
        { phaseNumber: 2, requestedMode: "basic", reason: "basic-selected" },
    ],
});

// What the adapter's designAnalysisInput() returns for DESIGN_ROW.
const ANALYSIS_INPUT = { input: { questions: ["p1-q1"] }, hash: "sha256:input" };

// The condition of reserveDesignAnalysisGeneration() and saveReviewedDesignAnalysis().
const isInFlight = row => ["requested", "processing"].includes(row.status) && !row.is_stale;

function makeDependencies(overrides = {}) {
    const calls = {
        saveReviewed: [], reserveGeneration: [], dispatchGeneration: [], describeUnits: [],
    };
    const rows = [READY_ROW, BUSY_ROW, STALE_ROW];
    const findRow = serviceId => rows.find(row => row.service_id === serviceId) ?? null;

    const saveReviewed = async args => {
        calls.saveReviewed.push(args);
        return { ...READY_ROW, service_id: args.serviceId, document_schema: args.documentSchema };
    };
    // The first reservation of a service creates its row.
    const reserveGeneration = async args => {
        calls.reserveGeneration.push(args);
        const row = findRow(args.serviceId);
        if (row && isInFlight(row)) {
            return { designChanged: false, reservation: null };
        }
        return {
            designChanged: false,
            reservation:   {
                ...(row ?? READY_ROW),
                service_id: args.serviceId,
                status:     "requested",
                document:   row?.document ?? null,
                job_id:     JOB_ID,
            },
        };
    };
    const dispatchGeneration = (designRow, reservation, options) => {
        calls.dispatchGeneration.push({ designRow, reservation, options });
    };

    const dependencies = {
        getOwnedDesign:  async (designId, userId) => (userId === OWNER_ID ? DESIGN_ROW : null),
        listAnalyses:    async () => rows,
        getAnalysis:     async ({ serviceId }) => findRow(serviceId),
        isDesignService: async serviceId => DESIGN_SERVICES.includes(serviceId),
        getValidator:    async () => null,
        isServiceUsable: async () => true,
        resolveInput:    async () => ANALYSIS_INPUT,
        describeUnits:   async (args) => {
            calls.describeUnits.push(args);
            return SELECTION;
        },
        saveReviewed,
        reserveGeneration,
        dispatchGeneration,
        ...overrides,
    };

    return { dependencies, calls };
}

// ─── reads ───────────────────────────────────────────────────────────────────

test("listDesignAnalysesForOwner: lists the analyses without documents", async () => {
    const { dependencies } = makeDependencies();

    const { status, body } = await listDesignAnalysesForOwner({
        designId: 5,
        userId:   OWNER_ID,
        dependencies,
    });

    assert.equal(status, 200);
    assert.deepEqual(body.result.map(({ serviceId }) => serviceId), [
        "svc-ready", "svc-busy", "svc-stale",
    ]);
    assert.deepEqual(body.result[0], {
        serviceId:      "svc-ready",
        status:         "ready",
        stale:          false,
        documentSchema: "claim-typology/v1",
        errorCode:      null,
        errorMessage:   null,
        requestedAt:    "2026-10-27T10:00:00.000Z",
        generatedAt:    "2026-10-27T10:05:00.000Z",
        reviewedAt:     null,
        updatedAt:      "2026-10-27T10:05:00.000Z",
    });
    assert.equal(body.result[2].stale, true);
});

test("listDesignAnalysesForOwner: 404 for a design of another teacher", async () => {
    const { dependencies } = makeDependencies();

    const { status, body } = await listDesignAnalysesForOwner({
        designId: 5,
        userId:   OTHER_TEACHER_ID,
        dependencies,
    });

    assert.equal(status, 404);
    assert.equal(body.code, "DESIGN_NOT_FOUND");
});

test("getDesignAnalysisForOwner: one analysis with its document, its units and the tutor modes", async () => {
    const { dependencies, calls } = makeDependencies();

    const { status, body } = await getDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 200);
    assert.deepEqual(body.result.analysis.document, { typologies: [] });
    assert.equal(body.result.analysis.serviceId, "svc-ready");
    assert.deepEqual(body.result.units, [UNIT]);
    assert.equal(body.result.unitsReason, null);
    assert.equal(body.result.producerUsable, true);
    assert.deepEqual(body.result.tutorModes, SELECTION.tutorModes);
    assert.deepEqual(body.result.tutorPhases, SELECTION.tutorPhases,
        "the tutor's phases and the mode each requests (#870)");
    assert.deepEqual(calls.describeUnits, [{ serviceId: "svc-ready", designRow: DESIGN_ROW }]);
});

test("getDesignAnalysisForOwner: a design service without an analysis yet still lists its units", async () => {
    const { dependencies } = makeDependencies({
        isServiceUsable: async () => false,
        describeUnits:   async () => ({ units: [], unitsReason: "consumers-unusable", tutorModes: {} }),
    });

    const { status, body } = await getDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-new",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 200);
    assert.deepEqual(body.result, {
        analysis:       null,
        units:          [],
        unitsReason:    "consumers-unusable",
        producerUsable: false,
        tutorModes:     {},
        tutorPhases:    [],
    });
});

test("getDesignAnalysisForOwner: 404 for an unknown service without an analysis or for another teacher", async () => {
    const { dependencies } = makeDependencies();

    const missing = await getDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-unknown",
        userId:    OWNER_ID,
        dependencies,
    });
    const otherTeacher = await getDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-ready",
        userId:    OTHER_TEACHER_ID,
        dependencies,
    });

    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "DESIGN_ANALYSIS_NOT_FOUND");
    assert.equal(otherTeacher.status, 404);
    assert.equal(otherTeacher.body.code, "DESIGN_NOT_FOUND");
});

// ─── teacher edits ───────────────────────────────────────────────────────────

test("saveDesignAnalysisForOwner: 405 when the service has no validator", async () => {
    const { dependencies, calls } = makeDependencies();

    const { status, body } = await saveDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        document:  { typologies: [1] },
        dependencies,
    });

    assert.equal(status, 405);
    assert.equal(body.code, "DESIGN_ANALYSIS_NOT_EDITABLE");
    assert.equal(calls.saveReviewed.length, 0);
});

test("saveDesignAnalysisForOwner: stores the document and schema from the validator", async () => {
    const validatorCalls = [];
    const { dependencies, calls } = makeDependencies({
        getValidator: async () => async (document, context) => {
            validatorCalls.push({ document, context });
            return { document: { ...document, normalized: true }, documentSchema: "claim-typology/v2" };
        },
    });

    const { status, body } = await saveDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        document:  { typologies: [1] },
        dependencies,
    });

    assert.equal(status, 200);
    assert.deepEqual(body.result.document, { typologies: [1], normalized: true });
    assert.deepEqual(validatorCalls[0].context, {
        designId:     5,
        caseId:       42,
        languageCode: "es",
        design:       DESIGN_ROW.design,
    });
    assert.deepEqual(calls.saveReviewed, [{
        designId:       5,
        serviceId:      "svc-ready",
        documentSchema: "claim-typology/v2",
        document:       { typologies: [1], normalized: true },
        userId:         OWNER_ID,
    }]);
});

test("saveDesignAnalysisForOwner: 400 with the validator's errors, without saving", async () => {
    const { dependencies, calls } = makeDependencies({
        getValidator: async () => async () => ({ errors: ["q0: unknown question"] }),
    });

    const { status, body } = await saveDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        document:  {},
        dependencies,
    });

    assert.equal(status, 400);
    assert.equal(body.code, "DESIGN_ANALYSIS_DOCUMENT_INVALID");
    assert.deepEqual(body.details, ["q0: unknown question"]);
    assert.equal(calls.saveReviewed.length, 0);
});

test("saveDesignAnalysisForOwner: 409 while a generation is in flight", async () => {
    const { dependencies } = makeDependencies({
        getValidator: async () => async document => ({ document }),
        saveReviewed: async () => null,
    });

    const { status, body } = await saveDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-busy",
        userId:    OWNER_ID,
        document:  {},
        dependencies,
    });

    assert.equal(status, 409);
    assert.equal(body.code, "DESIGN_ANALYSIS_PROCESSING");
});

test("saveDesignAnalysisForOwner: 409 on a locked design, without validating", async () => {
    const { dependencies, calls } = makeDependencies({
        getOwnedDesign: async () => LOCKED_DESIGN_ROW,
        getValidator:   async () => async () => assert.fail("no validation expected"),
    });

    const { status, body } = await saveDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        document:  {},
        dependencies,
    });

    assert.equal(status, 409);
    assert.equal(body.code, "DESIGN_LOCKED");
    assert.equal(calls.saveReviewed.length, 0);
});

// ─── generation ──────────────────────────────────────────────────────────────

test("generateDesignAnalysisForOwner: 202 for settled, stale and new analyses", async () => {
    const { dependencies, calls } = makeDependencies();

    for (const serviceId of ["svc-ready", "svc-stale", "svc-new"]) {
        const { status, body } = await generateDesignAnalysisForOwner({
            designId: 5,
            serviceId,
            userId:   OWNER_ID,
            dependencies,
        });

        assert.equal(status, 202, serviceId);
        assert.equal(body.result.status, "requested", serviceId);
        assert.equal(body.result.serviceId, serviceId);
    }

    // The input hash is stored even when it equals the stored one: an
    // explicit regeneration always runs. Each reservation is bound to the
    // design row the input was prepared from.
    assert.deepEqual(calls.reserveGeneration, ["svc-ready", "svc-stale", "svc-new"].map(serviceId => ({
        designId:       5,
        serviceId,
        inputHash:      "sha256:input",
        userId:         OWNER_ID,
        designSnapshot: DESIGN_SNAPSHOT,
    })));
    assert.deepEqual(
        calls.dispatchGeneration.map(({ designRow, reservation, options }) => [
            designRow, reservation.service_id, reservation.job_id, options,
        ]),
        ["svc-ready", "svc-stale", "svc-new"].map(serviceId => [
            DESIGN_ROW, serviceId, JOB_ID, { userId: OWNER_ID, analysis: ANALYSIS_INPUT },
        ])
    );
});

test("generateDesignAnalysisForOwner: an adapter without an input export stores no hash", async () => {
    const { dependencies, calls } = makeDependencies({
        resolveInput: async () => ({ input: null, hash: null }),
    });

    const { status } = await generateDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-new",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 202);
    assert.equal(calls.reserveGeneration[0].inputHash, null);
});

test("generateDesignAnalysisForOwner: 409 when the service does not apply to the design", async () => {
    const resolved = [];
    const { dependencies, calls } = makeDependencies({
        resolveInput: async (designRow, serviceId) => {
            resolved.push([designRow, serviceId]);
            return null;
        },
    });

    const { status, body } = await generateDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-new",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 409);
    assert.equal(body.code, "DESIGN_ANALYSIS_NOT_APPLICABLE");
    assert.deepEqual(resolved, [[DESIGN_ROW, "svc-new"]]);
    assert.equal(calls.reserveGeneration.length, 0);
    assert.equal(calls.dispatchGeneration.length, 0);
});

test("generateDesignAnalysisForOwner: 409 DESIGN_CHANGED when a save changed the design meanwhile", async () => {
    const { dependencies, calls } = makeDependencies({
        reserveGeneration: async args => {
            calls.reserveGeneration.push(args);
            return { designChanged: true, reservation: null };
        },
    });

    const { status, body } = await generateDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 409);
    assert.equal(body.code, "DESIGN_CHANGED");
    assert.match(body.message, /Try again/);
    assert.deepEqual(calls.reserveGeneration[0].designSnapshot, DESIGN_SNAPSHOT);
    assert.equal(calls.dispatchGeneration.length, 0);
});

test("generateDesignAnalysisForOwner: 409 while a generation is in flight", async () => {
    const { dependencies, calls } = makeDependencies();

    const { status, body } = await generateDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-busy",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 409);
    assert.equal(body.code, "DESIGN_ANALYSIS_PROCESSING");
    assert.equal(calls.reserveGeneration.length, 1);
    assert.equal(calls.dispatchGeneration.length, 0);
});

test("generateDesignAnalysisForOwner: 409 DESIGN_LOCKED on a locked design", async () => {
    const { dependencies, calls } = makeDependencies({
        getOwnedDesign: async () => LOCKED_DESIGN_ROW,
    });

    const { status, body } = await generateDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-ready",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 409);
    assert.equal(body.code, "DESIGN_LOCKED");
    assert.equal(calls.reserveGeneration.length, 0);
    assert.equal(calls.dispatchGeneration.length, 0);
});

test("generateDesignAnalysisForOwner: 503 when the service is not usable", async () => {
    const { dependencies, calls } = makeDependencies({ isServiceUsable: async () => false });

    const { status, body } = await generateDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-new",
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 503);
    assert.equal(body.code, "DESIGN_ANALYSIS_SERVICE_DISABLED");
    assert.equal(calls.reserveGeneration.length, 0);
});

test("generateDesignAnalysisForOwner: 404 for other services and designs of others", async () => {
    const { dependencies, calls } = makeDependencies();

    const notDesignScoped = await generateDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-case-only",
        userId:    OWNER_ID,
        dependencies,
    });
    const otherTeacher = await generateDesignAnalysisForOwner({
        designId:  5,
        serviceId: "svc-new",
        userId:    OTHER_TEACHER_ID,
        dependencies,
    });

    assert.equal(notDesignScoped.status, 404);
    assert.equal(notDesignScoped.body.code, "DESIGN_ANALYSIS_SERVICE_NOT_FOUND");
    assert.equal(otherTeacher.status, 404);
    assert.equal(otherTeacher.body.code, "DESIGN_NOT_FOUND");
    assert.equal(calls.reserveGeneration.length, 0);
});

// ─── routes ──────────────────────────────────────────────────────────────────

// Serves the router in an in-memory app whose requests carry the given role.
async function serve(router, { role, uid = OWNER_ID }) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = { uid, role };
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

const ROUTES = [
    ["GET", "/designs/5/analyses"],
    ["GET", "/designs/5/analyses/svc-ready"],
    ["PUT", "/designs/5/analyses/svc-ready", { document: {} }],
    ["POST", "/designs/5/analyses/svc-ready/generate"],
];

test("routes: students get 403 and invalid design ids 400, before any lookup", async () => {
    const student = await serve(designAnalysesRouter, { role: "A" });
    const teacher = await serve(designAnalysesRouter, { role: "P" });
    try {
        for (const [method, path, body] of ROUTES) {
            const { status } = await student.request(method, path, body);
            assert.equal(status, 403, `${method} ${path}`);
        }

        assert.equal((await teacher.request("GET", "/designs/abc/analyses")).status, 400);
        assert.equal((await teacher.request("POST", "/designs/0/analyses/svc/generate")).status, 400);
    } finally {
        await student.close();
        await teacher.close();
    }
});

test("routes: other teachers get 404 on every route", async () => {
    const { dependencies, calls } = makeDependencies();
    const otherTeacher = await serve(createDesignAnalysesRouter(dependencies), {
        role: "P",
        uid:  OTHER_TEACHER_ID,
    });
    try {
        for (const [method, path, body] of ROUTES) {
            const { status, body: response } = await otherTeacher.request(method, path, body);
            assert.equal(status, 404, `${method} ${path}`);
            assert.equal(response.code, "DESIGN_NOT_FOUND");
        }
        assert.equal(calls.reserveGeneration.length, 0);
    } finally {
        await otherTeacher.close();
    }
});

test("routes: the owner reads, cannot edit (405) and regenerates (202)", async () => {
    const { dependencies } = makeDependencies();
    const owner = await serve(createDesignAnalysesRouter(dependencies), { role: "P" });
    try {
        assert.equal((await owner.request("GET", "/designs/5/analyses")).status, 200);
        assert.equal((await owner.request("GET", "/designs/5/analyses/svc-ready")).status, 200);
        assert.equal((await owner.request("GET", "/designs/5/analyses/svc-new")).status, 200);
        assert.equal((await owner.request("GET", "/designs/5/analyses/svc-unknown")).status, 404);

        const edit = await owner.request("PUT", "/designs/5/analyses/svc-ready", { document: {} });
        assert.equal(edit.status, 405);

        const generated = await owner.request("POST", "/designs/5/analyses/svc-new/generate");
        assert.equal(generated.status, 202);
        assert.equal(generated.body.result.status, "requested");
    } finally {
        await owner.close();
    }
});

// In-memory design_analyses rows updated under the conditions of the helper's
// SQL: each call yields first, like a query round trip, then checks and writes
// without yielding, as one statement does under its row lock.
function makeAnalysisTable() {
    const rows = new Map();
    const roundTrip = () => new Promise(resolve => setImmediate(resolve));
    let jobCount = 0;

    return {
        rows,
        async reserveGeneration({ serviceId }) {
            await roundTrip();
            const row = rows.get(serviceId);
            if (row && isInFlight(row)) {
                return { designChanged: false, reservation: null };
            }
            const reserved = {
                ...(row ?? { service_id: serviceId, document: null, is_stale: false }),
                status: "requested",
                job_id: `job-${++jobCount}`,
            };
            rows.set(serviceId, reserved);
            return { designChanged: false, reservation: { ...reserved } };
        },
    };
}

test("routes: of two concurrent generate requests one gets 202 and one 409", async () => {
    const table = makeAnalysisTable();
    const dispatched = [];
    const { dependencies } = makeDependencies({
        reserveGeneration:  table.reserveGeneration,
        dispatchGeneration: (designRow, reservation) => { dispatched.push(reservation); },
    });
    const owner = await serve(createDesignAnalysesRouter(dependencies), { role: "P" });

    try {
        const responses = await Promise.all([1, 2].map(() =>
            owner.request("POST", "/designs/5/analyses/svc-new/generate")
        ));

        assert.deepEqual(responses.map(({ status }) => status).sort(), [202, 409]);
        assert.equal(dispatched.length, 1, "a single generation is dispatched");
        assert.equal(dispatched[0].job_id, table.rows.get("svc-new").job_id);
    } finally {
        await owner.close();
    }
});

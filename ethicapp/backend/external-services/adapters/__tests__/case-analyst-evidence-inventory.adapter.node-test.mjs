import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { saveCaseAnalysisForOwner } from "../../../controllers/case-analyses.js";
import { AiAdditionsClient } from "../../../services/ai-additions-client.service.js";
import {
    buildEvidenceInventoryRequest,
    DOCUMENT_SCHEMA,
    getUiTranslations,
    normalizeCaseLanguage,
    register,
    validateCaseAnalysisDocument,
} from "../case-analyst-evidence-inventory.adapter.js";

const SERVICE_ID = "case-analyst-evidence-inventory";
const JOB_ID     = "c1d2e3f4-0000-4000-8000-000000000021";
const NEWER_JOB  = "c1d2e3f4-0000-4000-8000-000000000022";

// The service's own examples (ethicapp-ai-additions,
// case-analyst/app/modules/evidence_inventory/examples/): the extracted text
// of the Sebastián case and the completed result for it.
function loadExample(name) {
    const url = new URL(`../../../helpers/__tests__/fixtures/evidence-inventory/${name}`, import.meta.url);
    return JSON.parse(readFileSync(url, "utf8"));
}

const EXAMPLE_REQUEST = loadExample("request.sebastian.json");
const EXAMPLE_RESULT  = loadExample("result.sebastian.json");
const CASE_TEXT       = EXAMPLE_REQUEST.case.text;

/**
 * An in-memory case analysis with the conditions of the case analyses store
 * (helpers/analyses-store-helper.js): a generation starts only while it is the
 * reserved one, and its result applies only while it is still processing
 * under its job id. Anything else returns null.
 */
function createCaseAnalysisRow({ jobId = JOB_ID, status = "requested", document = null } = {}) {
    const row = {
        case_id:         7,
        status,
        job_id:          jobId,
        document,
        document_schema: null,
        error_code:      null,
        error_message:   null,
    };
    const calls = [];

    const caseAnalyses = {
        async markProcessing({ caseId, jobId: requestedJobId }) {
            calls.push({ name: "markProcessing", args: { caseId, jobId: requestedJobId } });
            if (!requestedJobId || row.job_id !== requestedJobId || row.status !== "requested") {
                return null;
            }
            row.status = "processing";
            return { status: row.status, jobId: requestedJobId };
        },
        async complete({ jobId: resultJobId, documentSchema, document: resultDocument }) {
            calls.push({ name: "complete", args: { jobId: resultJobId, documentSchema } });
            if (row.job_id !== resultJobId || row.status !== "processing") {
                return null;
            }
            Object.assign(row, {
                status:          "ready",
                document:        resultDocument,
                document_schema: documentSchema,
                error_code:      null,
                error_message:   null,
            });
            return { ...row };
        },
        async fail({ jobId: resultJobId, errorCode, errorMessage }) {
            calls.push({ name: "fail", args: { jobId: resultJobId, errorCode, errorMessage } });
            if (row.job_id !== resultJobId || row.status !== "processing") {
                return null;
            }
            Object.assign(row, {
                status:        row.document ? "ready" : "failed",
                error_code:    errorCode,
                error_message: errorMessage,
            });
            return { ...row };
        },
        // What POST /cases/:id/analyses/:serviceId/generate does.
        reserve(newJobId) {
            row.job_id = newJobId;
            row.status = "requested";
        },
    };

    return { row, calls, caseAnalyses };
}

function fakeClient({ respond } = {}) {
    const requests = [];
    return {
        requests,
        async requestJson(pathname, options) {
            requests.push({ pathname, ...options });
            return respond ? respond(pathname, options) : { taskId: "task-1", status: "pending" };
        },
    };
}

async function registerAdapter({
    caseAnalyses,
    client = fakeClient(),
    renderOutcome = { status: "ready", text: CASE_TEXT },
} = {}) {
    const subscribers = new Map();
    const waited = [];

    await register({
        service:                       { id: SERVICE_ID },
        subscribe:                     (hookName, handler) => subscribers.set(hookName, handler),
        aiAdditionsClient:             client,
        caseAnalyses,
        evidenceInventoryDependencies: {
            waitForCaseDocumentText: async (caseId) => {
                waited.push(caseId);
                return renderOutcome;
            },
        },
    });

    async function dispatch(hookName, context) {
        const callbacks = [];
        await subscribers.get(hookName)(context, {
            callback: async (result) => { callbacks.push(result); },
        });
        return callbacks;
    }

    return { dispatch, client, waited };
}

// The context buildCaseCreatedContext() builds, plus the registry's job id.
function caseCreatedContext(overrides = {}) {
    return {
        caseId:         7,
        caseUuid:       "6a1c5b31-9837-49c2-80bb-817319c600e7",
        userId:         42,
        title:          " Caso Sebastián ",
        pdfPath:        "/uploads/cases/7.pdf",
        languageCode:   "es_CL",
        visibility:     "private",
        pdfRenderJobId: 3,
        jobId:          JOB_ID,
        correlationId:  JOB_ID,
        ...overrides,
    };
}

// The callback-received context for a result posted by Case Analyst.
function resultContext(payload, { correlationId = JOB_ID } = {}) {
    return {
        serviceId:      SERVICE_ID,
        eventType:      "result",
        correlationId,
        requestPayload: {
            ...EXAMPLE_RESULT,
            caseId:        "7",
            clientContext: { service: SERVICE_ID, correlationId, caseId: "7" },
            ...payload,
        },
    };
}

async function quietly(run) {
    const { info, warn } = console;
    console.info = () => {};
    console.warn = () => {};
    try {
        return await run();
    } finally {
        console.info = info;
        console.warn = warn;
    }
}

// ─── Request contract ────────────────────────────────────────────────────────

test("buildEvidenceInventoryRequest: follows the Case Analyst request envelope", () => {
    assert.deepEqual(
        buildEvidenceInventoryRequest({
            serviceId:     SERVICE_ID,
            caseId:        7,
            caseTitle:     " Caso Sebastián ",
            caseText:      " Texto del caso. ",
            languageCode:  "es_CL",
            correlationId: JOB_ID,
        }),
        {
            schemaVersion: "evidence-inventory-request/v1",
            case:          {
                id:       "7",
                title:    "Caso Sebastián",
                text:     "Texto del caso.",
                language: "es_CL",
            },
            clientContext: {
                service:       SERVICE_ID,
                correlationId: JOB_ID,
                caseId:        "7",
            },
        }
    );

    const untitled = buildEvidenceInventoryRequest({
        serviceId:     SERVICE_ID,
        caseId:        7,
        caseTitle:     "",
        caseText:      "x".repeat(200010),
        languageCode:  null,
        correlationId: JOB_ID,
    });
    assert.equal(untitled.case.title, "Case 7");
    assert.equal(untitled.case.text.length, 200000);
    assert.equal(untitled.case.language, "en_US");
});

test("normalizeCaseLanguage: Spanish only for es and es_*, English otherwise", () => {
    assert.equal(normalizeCaseLanguage("es_CL"), "es_CL");
    assert.equal(normalizeCaseLanguage("es"), "es_CL");
    assert.equal(normalizeCaseLanguage("es-AR"), "es_CL");
    assert.equal(normalizeCaseLanguage("en_US"), "en_US");
    assert.equal(normalizeCaseLanguage("pt_BR"), "en_US");
    assert.equal(normalizeCaseLanguage("estonian"), "en_US");
    assert.equal(normalizeCaseLanguage(null), "en_US");
});

test("getUiTranslations: labels, descriptions and tab titles in both UI locales", async () => {
    const translations = await getUiTranslations();

    for (const locale of ["es_CL", "en_US"]) {
        assert.ok(translations[locale].label, locale);
        assert.ok(translations[locale].description, locale);
        assert.ok(translations[locale].tabTitle, locale);
    }
});

// ─── case-created ────────────────────────────────────────────────────────────

test("case-created: starts the generation, waits for the text and requests the inventory", async () => {
    const { row, calls, caseAnalyses } = createCaseAnalysisRow();
    const { dispatch, client, waited } = await registerAdapter({ caseAnalyses });

    const callbacks = await quietly(() => dispatch("case-created", caseCreatedContext()));

    assert.deepEqual(calls, [{ name: "markProcessing", args: { caseId: 7, jobId: JOB_ID } }]);
    assert.deepEqual(waited, [7]);
    assert.equal(client.requests.length, 1);
    const [request] = client.requests;
    assert.equal(request.pathname, "/evidence-inventories");
    assert.equal(request.method, "POST");
    assert.equal(request.basePath, "/case-analyst/api/v1");
    assert.deepEqual(request.body, buildEvidenceInventoryRequest({
        serviceId:     SERVICE_ID,
        caseId:        7,
        caseTitle:     "Caso Sebastián",
        caseText:      CASE_TEXT,
        languageCode:  "es_CL",
        correlationId: JOB_ID,
    }));
    // The Case Analyst callback completes the job.
    assert.deepEqual(callbacks, []);
    assert.equal(row.status, "processing");
});

test("case-created: skips a generation that is no longer reserved, without waiting", async () => {
    const { calls, caseAnalyses } = createCaseAnalysisRow({ jobId: NEWER_JOB });
    const { dispatch, client, waited } = await registerAdapter({ caseAnalyses });

    const callbacks = await dispatch("case-created", caseCreatedContext());

    assert.deepEqual(calls.map(({ name }) => name), ["markProcessing"]);
    assert.deepEqual(waited, []);
    assert.equal(client.requests.length, 0);
    assert.equal(callbacks[0].status, "skipped");
});

test("case-created: fails the analysis with the render outcome when there is no text", async () => {
    const { row, caseAnalyses } = createCaseAnalysisRow();
    const { dispatch, client } = await registerAdapter({
        caseAnalyses,
        renderOutcome: { status: "render-failed" },
    });

    const callbacks = await dispatch("case-created", caseCreatedContext());

    assert.equal(client.requests.length, 0);
    assert.equal(row.status, "failed");
    assert.equal(row.error_code, "render-failed");
    assert.equal(callbacks[0].status, "failed");
});

test("case-created: fails the analysis when the case document has no text", async () => {
    const { row, caseAnalyses } = createCaseAnalysisRow();
    const { dispatch, client } = await registerAdapter({
        caseAnalyses,
        renderOutcome: { status: "ready", text: "  \n " },
    });

    await dispatch("case-created", caseCreatedContext());

    assert.equal(client.requests.length, 0);
    assert.equal(row.error_code, "empty-case-text");
});

test("case-created: tells a refused request from an unreachable service", async () => {
    for (const [statusCode, errorCode] of [[422, "request-rejected"], [503, "service-unreachable"]]) {
        const { row, caseAnalyses } = createCaseAnalysisRow();
        const client = fakeClient({
            respond: () => {
                throw Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
            },
        });
        const { dispatch } = await registerAdapter({ caseAnalyses, client });

        const callbacks = await quietly(() => dispatch("case-created", caseCreatedContext()));

        assert.equal(row.status, "failed", String(statusCode));
        assert.equal(row.error_code, errorCode);
        assert.equal(callbacks[0].status, "failed");
        assert.equal(callbacks[0].statusCode, statusCode);
    }
});

test("case-created: without an AI Additions connection, fails without any request", async () => {
    const urls = [];
    const client = new AiAdditionsClient({
        env: {
            AI_ADDITIONS_KEYCLOAK_CLIENT_ID:     "ethicapp-platform",
            AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET: "secret",
        },
        getConnection: async () => null,
        fetchImpl:     async (url) => {
            urls.push(url);
            throw new Error(`no request may leave the host, got ${url}`);
        },
    });
    const { row, caseAnalyses } = createCaseAnalysisRow();
    const { dispatch } = await registerAdapter({ caseAnalyses, client });

    await quietly(() => dispatch("case-created", caseCreatedContext()));

    assert.deepEqual(urls, []);
    assert.equal(row.error_code, "service-unreachable");
});

test("case-created: fails the started generation on an unexpected error", async () => {
    const { row, caseAnalyses } = createCaseAnalysisRow();
    const subscribers = new Map();
    await register({
        service:                       { id: SERVICE_ID },
        subscribe:                     (hookName, handler) => subscribers.set(hookName, handler),
        aiAdditionsClient:             fakeClient(),
        caseAnalyses,
        evidenceInventoryDependencies: {
            waitForCaseDocumentText: async () => { throw new Error("database unavailable"); },
        },
    });
    const callbacks = [];

    await subscribers.get("case-created")(caseCreatedContext(), {
        callback: async (result) => { callbacks.push(result); },
    });

    assert.equal(row.error_code, "adapter-error");
    assert.deepEqual(callbacks, [{
        hook:   "case-created",
        status: "failed",
        error:  "database unavailable",
    }]);
});

// ─── callback-received ───────────────────────────────────────────────────────

test("callback-received: stores a completed inventory as the analysis document", async () => {
    const { row, caseAnalyses } = createCaseAnalysisRow({ status: "processing" });
    const { dispatch } = await registerAdapter({ caseAnalyses });

    const callbacks = await dispatch("callback-received", resultContext({}));

    assert.equal(row.status, "ready");
    assert.equal(row.document_schema, DOCUMENT_SCHEMA);
    assert.deepEqual(row.document, EXAMPLE_RESULT.inventory);
    assert.deepEqual(callbacks, [{
        hook:       "callback-received",
        status:     "completed",
        caseId:     7,
        facts:      EXAMPLE_RESULT.inventory.facts.length,
        exclusions: EXAMPLE_RESULT.inventory.exclusions.length,
    }]);
});

test("callback-received: ignores the result of a superseded generation", async () => {
    const previous = { schemaVersion: DOCUMENT_SCHEMA, facts: [], exclusions: [] };
    const { row, caseAnalyses } = createCaseAnalysisRow({ status: "processing", document: previous });
    // The teacher generated it again before the first result arrived.
    caseAnalyses.reserve(NEWER_JOB);
    const { dispatch } = await registerAdapter({ caseAnalyses });

    const completed = await dispatch("callback-received", resultContext({}));
    const failed = await dispatch("callback-received", resultContext({
        status:    "failed",
        inventory: null,
        error:     { code: "timeout", message: "The analysis took too long." },
    }));

    assert.deepEqual(completed, [{
        hook:   "callback-received",
        status: "skipped",
        reason: "superseded-generation",
    }]);
    assert.equal(failed[0].status, "skipped");
    assert.equal(row.job_id, NEWER_JOB);
    assert.equal(row.status, "requested");
    assert.equal(row.document, previous);
    assert.equal(row.error_code, null);
});

test("callback-received: records a failed generation with the service's code and message", async () => {
    const previous = { schemaVersion: DOCUMENT_SCHEMA, facts: [], exclusions: [] };
    const { row, caseAnalyses } = createCaseAnalysisRow({ status: "processing", document: previous });
    const { dispatch } = await registerAdapter({ caseAnalyses });

    const callbacks = await dispatch("callback-received", resultContext({
        status:    "failed",
        inventory: null,
        error:     { code: "llm_refused", message: "The model refused the request." },
    }));

    // A failed generation keeps the previous document.
    assert.equal(row.status, "ready");
    assert.equal(row.document, previous);
    assert.equal(row.error_code, "service:llm_refused");
    assert.equal(row.error_message, "The model refused the request.");
    assert.equal(callbacks[0].status, "failed");
});

test("callback-received: refuses inventories that break the contract", async () => {
    const invalidInventories = [
        { ...EXAMPLE_RESULT.inventory, facts: [{ statement: "" }] },
        { ...EXAMPLE_RESULT.inventory, schemaVersion: "evidence-inventory/v2" },
        null,
    ];

    for (const inventory of invalidInventories) {
        const { row, caseAnalyses } = createCaseAnalysisRow({ status: "processing" });
        const { dispatch } = await registerAdapter({ caseAnalyses });

        const callbacks = await quietly(() => dispatch("callback-received", resultContext({ inventory })));

        assert.equal(row.status, "failed");
        assert.equal(row.error_code, "inventory-invalid");
        assert.equal(callbacks[0].status, "failed");
    }
});

test("callback-received: refuses payloads that are not evidence inventory results", async () => {
    for (const payload of [{ schemaVersion: "topic-listing-result/v1" }, { status: "pending" }]) {
        const { row, caseAnalyses } = createCaseAnalysisRow({ status: "processing" });
        const { dispatch } = await registerAdapter({ caseAnalyses });

        await dispatch("callback-received", resultContext(payload));

        assert.equal(row.error_code, "result-invalid");
    }
});

test("callback-received: fails the generation when its result cannot be stored", async () => {
    const { row, caseAnalyses } = createCaseAnalysisRow({ status: "processing" });
    caseAnalyses.complete = async () => { throw new Error("database unavailable"); };
    const { dispatch } = await registerAdapter({ caseAnalyses });

    const callbacks = await dispatch("callback-received", resultContext({}));

    assert.equal(row.error_code, "adapter-error");
    assert.deepEqual(callbacks, [{
        hook:   "callback-received",
        status: "failed",
        error:  "database unavailable",
    }]);
});

// ─── Teacher edits ───────────────────────────────────────────────────────────

test("validateCaseAnalysisDocument: verifies every quote again against the case text", async () => {
    const edited = structuredClone(EXAMPLE_RESULT.inventory);
    edited.facts[0].sourceQuoteFound = false;
    edited.facts[1].sourceQuote = "una cita que el caso no tiene";
    edited.facts[1].sourceQuoteFound = true;
    edited.facts.push({ statement: "Un hecho agregado a mano." });

    const { documentSchema, document } = await validateCaseAnalysisDocument(edited, {
        caseId:       7,
        languageCode: "es_CL",
        getCaseText:  async () => CASE_TEXT,
    });

    assert.equal(documentSchema, DOCUMENT_SCHEMA);
    assert.equal(document.facts[0].sourceQuoteFound, true);
    assert.equal(document.facts[1].sourceQuoteFound, false);
    assert.deepEqual(document.facts.at(-1), {
        id:               `EV${edited.facts.length}`,
        group:            "General",
        label:            "Un hecho agregado a mano.",
        statement:        "Un hecho agregado a mano.",
        sourceQuote:      null,
        sourceQuoteFound: false,
        countingNote:     null,
    });
    assert.ok(document.facts.slice(2, -1).every(fact => fact.sourceQuoteFound));
});

test("validateCaseAnalysisDocument: without the case text, no quote counts as found", async () => {
    const { document } = await quietly(() => validateCaseAnalysisDocument(EXAMPLE_RESULT.inventory, {
        caseId:      7,
        getCaseText: async () => { throw new Error("no rendered text"); },
    }));

    assert.ok(document.facts.every(fact => fact.sourceQuoteFound === false));
});

test("validateCaseAnalysisDocument: lists the problems of an invalid edit", async () => {
    const result = await validateCaseAnalysisDocument(
        { facts: [{ statement: " " }], exclusions: "none" },
        { caseId: 7, getCaseText: async () => CASE_TEXT }
    );

    assert.deepEqual(result, { errors: ["exclusions must be an array"] });
});

test("PUT /cases/:id/analyses/:serviceId: stores the checked edit as reviewed", async () => {
    const saved = [];
    const edited = structuredClone(EXAMPLE_RESULT.inventory);
    edited.facts = edited.facts.slice(1);

    const response = await saveCaseAnalysisForOwner({
        caseId:       7,
        serviceId:    SERVICE_ID,
        userId:       42,
        document:     edited,
        dependencies: {
            getOwnedCase: async () => ({ id: 7, language_code: "es_CL" }),
            getAnalysis:  async () => ({ service_id: SERVICE_ID, status: "ready" }),
            getValidator: async () => validateCaseAnalysisDocument,
            getCaseText:  async () => CASE_TEXT,
            saveReviewed: async (args) => {
                saved.push(args);
                return { service_id: SERVICE_ID, status: "ready", reviewed_at: "2026-10-27T12:00:00Z" };
            },
        },
    });

    assert.equal(response.status, 200);
    assert.equal(saved[0].documentSchema, DOCUMENT_SCHEMA);
    assert.equal(saved[0].userId, 42);
    assert.deepEqual(saved[0].document.facts.map(fact => fact.id), edited.facts.map(fact => fact.id));
    assert.equal(response.body.result.reviewedAt, "2026-10-27T12:00:00Z");
    assert.deepEqual(response.body.result.document, saved[0].document);
});

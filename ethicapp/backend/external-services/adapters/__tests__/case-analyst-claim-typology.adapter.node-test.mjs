import assert from "node:assert/strict";
import test from "node:test";
import { hashAnalysisInput, sha256Text } from "../../../helpers/analysis-input-hash.js";
import { AiAdditionsNotConfiguredError } from "../../../services/ai-additions-client.service.js";
import {
    annotateTypology,
    buildClaimTypologyRequest,
    caseAnalystLanguage,
    CASE_ANALYST_API_BASE_PATH,
    CLAIM_TYPOLOGY_SCHEMA,
    designAnalysisInput,
    EVIDENCE_INVENTORY_SERVICE_ID,
    getUiTranslations,
    loadEvidenceInventory,
    MAX_CLAIM_TYPOLOGY_QUESTIONS,
    register,
    requestFailure,
    serviceFailure,
} from "../case-analyst-claim-typology.adapter.js";

const JOB_ID = "c1a2b3c4-0000-4000-8000-000000000849";

const TUTOR = { externalServices: { enabledServiceIds: ["argumentation-tutor-system"] } };

function designWith(phases) {
    return { type: "semantic_differential", valid: true, phases };
}

const DESIGN = designWith([
    { ...TUTOR, questions: [{ q_text: "Should Camila omit the data?" }, { q_text: " " }, { q_text: "Why?" }] },
    { questions: [{ q_text: "Not discussed with the tutor." }] },
    { ...TUTOR, questions: [{ q_text: "**Is** the request acceptable?", q_text_content_type: "text/markdown" }] },
]);

const DESIGN_CASE = { id: 57, title: "The report data", languageCode: "es_CL", contentHash: "sha256:pdf" };

const INVENTORY = {
    schemaVersion: "evidence-inventory/v1",
    kind:          "case_evidence_inventory",
    language:      "es_CL",
    facts:         [
        { id: "EV1", label: "drop in two districts", statement: "Participation fell in two districts" },
        { id: "EV2", label: "the manager's request", statement: "Andrea asks Camila to leave them out" },
    ],
};

const allowTutor = async () => true;
const noInventory = async () => null;

function inputOf(design = DESIGN, designCase = DESIGN_CASE, overrides = {}) {
    return designAnalysisInput(
        { design, designCase },
        { isTutorAllowed: allowTutor, getAnalysis: noInventory, ...overrides }
    );
}

function quietly(action) {
    const originalWarn = console.warn;
    const originalInfo = console.info;
    console.warn = () => {};
    console.info = () => {};
    return Promise.resolve()
        .then(action)
        .finally(() => {
            console.warn = originalWarn;
            console.info = originalInfo;
        });
}

// ─── input ───────────────────────────────────────────────────────────────────

test("designAnalysisInput: selects the tutor questions with positional ids", async () => {
    const { input, hash } = await inputOf();

    assert.deepEqual(input.case, { language: "es_CL", contentHash: "sha256:pdf", title: "The report data" });
    assert.deepEqual(input.questions.map(({ id, phaseNumber, questionNumber, text }) => [
        id, phaseNumber, questionNumber, text,
    ]), [
        ["p1-q1", 1, 1, "Should Camila omit the data?"],
        ["p1-q3", 1, 3, "Why?"],
        ["p3-q1", 3, 1, "Is the request acceptable?"],
    ]);
    assert.equal(input.evidenceInventory, null);
    assert.equal(hash, hashAnalysisInput({
        case:              { language: "es_CL", contentHash: "sha256:pdf" },
        questions:         input.questions.map(({ id, textHash }) => ({ id, textHash })),
        evidenceInventory: null,
    }));
});

test("designAnalysisInput: declines without a case, without tutor questions, or without the tutor", async () => {
    assert.equal(await inputOf(DESIGN, null), null);
    assert.equal(await inputOf(designWith([{ questions: [{ q_text: "No tutor here." }] }])), null);
    assert.equal(await inputOf(designWith([{ ...TUTOR, questions: [{ q_text: "" }] }])), null);
    assert.equal(await inputOf({ ...DESIGN, type: "ranking" }), null);

    let inventoryRead = false;
    assert.equal(await inputOf(DESIGN, DESIGN_CASE, {
        isTutorAllowed: async () => false,
        getAnalysis:    async () => { inventoryRead = true; return null; },
    }), null);
    assert.equal(inventoryRead, false, "nothing is read when the policy does not allow the tutor");
});

test("designAnalysisInput: sends the first 30 tutor questions of a larger design", async () => {
    const questions = Array.from({ length: 32 }, (_, index) => ({ q_text: `Question ${index + 1}?` }));
    const design = designWith([{ ...TUTOR, questions }]);

    const { input } = await quietly(() => inputOf(design));

    assert.equal(MAX_CLAIM_TYPOLOGY_QUESTIONS, 30);
    assert.equal(input.questions.length, 30);
    assert.equal(input.questions.at(-1).id, "p1-q30");
});

test("designAnalysisInput: the hash changes with a question, the case, its language or its inventory", async () => {
    const hashOf = async (design, designCase = DESIGN_CASE, overrides = {}) =>
        (await inputOf(design, designCase, overrides)).hash;
    const base = await hashOf(DESIGN);

    assert.equal(await hashOf(structuredClone(DESIGN)), base, "the same content, the same hash");
    assert.equal(await hashOf(DESIGN, { ...DESIGN_CASE, id: 99, title: "Copy" }), base,
        "a copied case keeps the hash");

    const edited = structuredClone(DESIGN);
    edited.phases[0].questions[2].q_text = "Why not?";
    assert.notEqual(await hashOf(edited), base);

    const untouchedPhase = structuredClone(DESIGN);
    untouchedPhase.phases[1].questions[0].q_text = "Changed outside the tutor.";
    assert.equal(await hashOf(untouchedPhase), base, "phases without the tutor do not count");

    assert.notEqual(await hashOf(DESIGN, { ...DESIGN_CASE, contentHash: "sha256:other" }), base);
    assert.notEqual(await hashOf(DESIGN, { ...DESIGN_CASE, languageCode: "en_US" }), base);
    assert.equal(await hashOf(DESIGN, { ...DESIGN_CASE, languageCode: "es" }), base,
        "es and es_CL are the same Case Analyst language");

    const withInventory = await hashOf(DESIGN, DESIGN_CASE, {
        getAnalysis: async () => ({ status: "ready", document: INVENTORY }),
    });
    assert.notEqual(withInventory, base);

    const regenerated = structuredClone(INVENTORY);
    regenerated.facts[1].statement = "Andrea asks Camila to drop them";
    assert.notEqual(await hashOf(DESIGN, DESIGN_CASE, {
        getAnalysis: async () => ({ status: "ready", document: regenerated }),
    }), withInventory, "a regenerated inventory runs the typology again");
});

test("designAnalysisInput: includes the case's evidence inventory when it has one", async () => {
    const reads = [];
    const { input } = await inputOf(DESIGN, DESIGN_CASE, {
        getAnalysis: async args => { reads.push(args); return { status: "ready", document: INVENTORY }; },
    });

    assert.deepEqual(reads, [{ caseId: 57, serviceId: EVIDENCE_INVENTORY_SERVICE_ID }]);
    assert.deepEqual(input.evidenceInventory, INVENTORY);
});

test("loadEvidenceInventory: ignores missing or foreign documents", async () => {
    const load = row => loadEvidenceInventory(57, { getAnalysis: async () => row });

    assert.equal(await load(null), null);
    assert.equal(await load({ status: "failed", document: null }), null);
    assert.equal(await load({ status: "ready", document: { schemaVersion: "other/v1", facts: [] } }), null);
    assert.equal(await loadEvidenceInventory(null, { getAnalysis: async () => assert.fail() }), null);

    const inventory = await load({ status: "processing", document: INVENTORY });
    assert.deepEqual(inventory, { document: INVENTORY, hash: hashAnalysisInput(INVENTORY) });
});

test("caseAnalystLanguage: es and es_* are es_CL, anything else en_US", () => {
    assert.equal(caseAnalystLanguage("es_CL"), "es_CL");
    assert.equal(caseAnalystLanguage("es"), "es_CL");
    assert.equal(caseAnalystLanguage("es-AR"), "es_CL");
    assert.equal(caseAnalystLanguage("en_US"), "en_US");
    assert.equal(caseAnalystLanguage("pt_BR"), "en_US");
    assert.equal(caseAnalystLanguage("estonian"), "en_US");
    assert.equal(caseAnalystLanguage(null), "en_US");
});

// ─── request ─────────────────────────────────────────────────────────────────

test("buildClaimTypologyRequest: one claim-typology-request/v1 for every question", async () => {
    const { input } = await inputOf(DESIGN, DESIGN_CASE, {
        getAnalysis: async () => ({ status: "ready", document: INVENTORY }),
    });

    const request = buildClaimTypologyRequest({
        designId: 128, caseId: 57, jobId: JOB_ID, input, caseText: "Camila works...",
    });

    assert.deepEqual(request, {
        schemaVersion: "claim-typology-request/v1",
        case:          { id: "57", title: "The report data", text: "Camila works...", language: "es_CL" },
        questions:     [
            { id: "p1-q1", phaseId: 1, text: "Should Camila omit the data?" },
            { id: "p1-q3", phaseId: 1, text: "Why?" },
            { id: "p3-q1", phaseId: 3, text: "Is the request acceptable?" },
        ],
        evidenceInventory: INVENTORY,
        clientContext:     {
            service:            "case-analyst-claim-typology",
            correlationId:      JOB_ID,
            designId:           "128",
            caseId:             "57",
            questionTextHashes: {
                "p1-q1": sha256Text("Should Camila omit the data?"),
                "p1-q3": sha256Text("Why?"),
                "p3-q1": sha256Text("Is the request acceptable?"),
            },
        },
    });
    for (const question of request.questions) {
        assert.equal(Number.isInteger(question.phaseId), true, "phaseId is the integer phase number");
    }
});

test("buildClaimTypologyRequest: no inventory key without one, and a title fallback", async () => {
    const { input } = await inputOf(DESIGN, { ...DESIGN_CASE, title: "  " });

    const request = buildClaimTypologyRequest({ designId: 1, caseId: 57, jobId: JOB_ID, input, caseText: "x" });

    assert.equal(Object.hasOwn(request, "evidenceInventory"), false);
    assert.equal(request.case.title, "Case 57");
});

// ─── design-saved ────────────────────────────────────────────────────────────

function makeDesignAnalyses({ processing = { status: "processing", jobId: JOB_ID }, complete, fail } = {}) {
    const calls = [];
    const designAnalyses = {
        markProcessing: async args => {
            calls.push({ name: "markProcessing", args });
            return processing;
        },
        complete: async args => {
            calls.push({ name: "complete", args });
            return complete ? complete(args) : { status: "ready" };
        },
        fail: async args => {
            calls.push({ name: "fail", args });
            return fail ? fail(args) : { status: "failed" };
        },
    };

    return { designAnalyses, calls };
}

function makeClient(respond = async () => ({ taskId: "task-1", status: "queued" })) {
    const requests = [];
    return {
        requests,
        client: {
            requestJson: async (pathname, options) => {
                requests.push({ pathname, ...options });
                return respond(pathname, options);
            },
        },
    };
}

async function registerAdapter({
    designAnalyses,
    client = makeClient().client,
    waitForCaseText = async () => ({ status: "ready", text: "Camila works as an analyst." }),
}) {
    const subscribers = new Map();
    await register({
        subscribe:                 (hookName, handler) => subscribers.set(hookName, handler),
        designAnalyses,
        aiAdditionsClient:         client,
        claimTypologyDependencies: { waitForCaseText },
    });
    return subscribers;
}

async function runDesignSaved({ designAnalyses, client, waitForCaseText, context }) {
    const subscribers = await registerAdapter({ designAnalyses, client, waitForCaseText });
    const { input } = await inputOf();

    const results = [];
    await quietly(() => subscribers.get("design-saved")(
        { designId: 128, caseId: 57, jobId: JOB_ID, analysisInput: input, ...context },
        { callback: async result => { results.push(result); } }
    ));
    return results;
}

test("design-saved: waits for the case text and sends one request, keeping the job dispatched", async () => {
    const { designAnalyses, calls } = makeDesignAnalyses();
    const { client, requests } = makeClient();
    const caseIds = [];

    const results = await runDesignSaved({
        designAnalyses,
        client,
        waitForCaseText: async caseId => { caseIds.push(caseId); return { status: "ready", text: " Text. " }; },
    });

    assert.deepEqual(caseIds, [57]);
    assert.deepEqual(calls.map(call => call.name), ["markProcessing"]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].pathname, "/claim-typologies");
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].basePath, CASE_ANALYST_API_BASE_PATH);
    assert.equal(requests[0].body.case.text, "Text.");
    assert.deepEqual(requests[0].body.questions.map(question => question.id), ["p1-q1", "p1-q3", "p3-q1"]);
    assert.equal(requests[0].body.clientContext.correlationId, JOB_ID);
    assert.deepEqual(results, [], "the callback-received handler settles the job");
});

test("design-saved: skips a generation that is no longer reserved", async () => {
    const { designAnalyses, calls } = makeDesignAnalyses({ processing: null });
    const { client, requests } = makeClient();

    const results = await runDesignSaved({ designAnalyses, client });

    assert.deepEqual(calls.map(call => call.name), ["markProcessing"]);
    assert.equal(requests.length, 0);
    assert.equal(results[0].status, "skipped");
});

test("design-saved: fails without input or without the case text", async () => {
    const missing = makeDesignAnalyses();
    await runDesignSaved({ designAnalyses: missing.designAnalyses, context: { analysisInput: null } });
    assert.equal(missing.calls[1].args.errorCode, "adapter-error");

    for (const status of ["no-document", "render-failed", "superseded", "timeout"]) {
        const { designAnalyses, calls } = makeDesignAnalyses();
        const { client, requests } = makeClient();
        const results = await runDesignSaved({
            designAnalyses, client, waitForCaseText: async () => ({ status }),
        });
        assert.equal(requests.length, 0);
        assert.equal(calls[1].name, "fail");
        assert.equal(calls[1].args.errorCode, status);
        assert.equal(results[0].status, "failed");
    }

    const empty = makeDesignAnalyses();
    await runDesignSaved({
        designAnalyses: empty.designAnalyses, waitForCaseText: async () => ({ status: "ready", text: "  " }),
    });
    assert.equal(empty.calls[1].args.errorCode, "empty-case-text");

    const long = makeDesignAnalyses();
    await runDesignSaved({
        designAnalyses:  long.designAnalyses,
        waitForCaseText: async () => ({ status: "ready", text: "x".repeat(200001) }),
    });
    assert.equal(long.calls[1].args.errorCode, "case-text-too-long");
});

test("design-saved: records why the request could not be sent", async () => {
    const cases = [
        [new AiAdditionsNotConfiguredError(), "request-failed"],
        [Object.assign(new Error("HTTP 422"), { statusCode: 422 }), "request-rejected"],
        [Object.assign(new Error("HTTP 401"), { statusCode: 401 }), "request-rejected"],
        [Object.assign(new Error("HTTP 502"), { statusCode: 502 }), "request-failed"],
        [new Error("socket hang up"), "request-failed"],
    ];

    for (const [error, errorCode] of cases) {
        const { designAnalyses, calls } = makeDesignAnalyses();
        const { client } = makeClient(async () => { throw error; });
        const results = await runDesignSaved({ designAnalyses, client });

        assert.equal(calls[1].name, "fail");
        assert.equal(calls[1].args.errorCode, errorCode);
        assert.equal(results[0].status, "failed");
    }
});

test("design-saved: an unexpected error fails the started generation", async () => {
    const { designAnalyses, calls } = makeDesignAnalyses();

    const results = await runDesignSaved({
        designAnalyses, waitForCaseText: async () => { throw new Error("db down"); },
    });

    assert.equal(calls[1].name, "fail");
    assert.equal(calls[1].args.errorCode, "adapter-error");
    assert.deepEqual(results, [{ hook: "design-saved", status: "failed", error: "db down" }]);
});

// ─── callback-received ───────────────────────────────────────────────────────

const TYPOLOGY_DOCUMENT = {
    schemaVersion: "claim-typology/v1",
    kind:          "design_claim_typology",
    language:      "es_CL",
    typologies:    [
        {
            questionId:  "p1-q1",
            phaseId:     1,
            focalAction: "Leave the two districts out of the report",
            types:       [
                { id: "AF1", label: "Omit", description: "...", stance: "in_favor", relatedEvidenceIds: ["EV2"] },
                { id: "AF2", label: "Include", description: "...", stance: "against", relatedEvidenceIds: [] },
            ],
        },
        {
            questionId:  "p3-q1",
            phaseId:     3,
            focalAction: "Ask an analyst to omit data",
            types:       [{ id: "AF1", label: "Acceptable", description: "...", stance: "conditional" }],
        },
    ],
    generation: {
        model:                 "gpt-5-mini",
        llmTier:               "basic",
        promptVersion:         "claimTypologyWithEvidence/v1@0123456789ab",
        generatedAt:           "2026-10-27T15:04:05Z",
        evidenceInventoryUsed: true,
    },
};

const CLIENT_CONTEXT = {
    service:            "case-analyst-claim-typology",
    correlationId:      JOB_ID,
    designId:           "128",
    questionTextHashes: { "p1-q1": "sha256:one" },
};

async function runCallback({ designAnalyses, payload, jobId = JOB_ID }) {
    const subscribers = await registerAdapter({ designAnalyses });
    const results = [];
    await subscribers.get("callback-received")(
        { serviceId: "case-analyst-claim-typology", jobId, requestPayload: payload },
        { callback: async result => { results.push(result); } }
    );
    return results;
}

test("callback-received: stores a completed typology with each question's text hash", async () => {
    const { designAnalyses, calls } = makeDesignAnalyses();

    const results = await runCallback({
        designAnalyses,
        payload: {
            schemaVersion: "claim-typology-result/v1",
            taskId:        "task-1",
            status:        "completed",
            clientContext: CLIENT_CONTEXT,
            claimTypology: TYPOLOGY_DOCUMENT,
        },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "complete");
    assert.equal(calls[0].args.jobId, JOB_ID);
    assert.equal(calls[0].args.documentSchema, CLAIM_TYPOLOGY_SCHEMA);
    const stored = calls[0].args.document;
    assert.deepEqual(stored.generation, TYPOLOGY_DOCUMENT.generation);
    assert.deepEqual(stored.typologies.map(typology => [typology.questionId, typology.questionTextHash]), [
        ["p1-q1", "sha256:one"],
        ["p3-q1", null],
    ]);
    assert.deepEqual(stored.typologies[0].types, TYPOLOGY_DOCUMENT.typologies[0].types);
    assert.equal(results[0].status, "completed");
});

test("callback-received: a superseded job's result is not stored", async () => {
    const { designAnalyses } = makeDesignAnalyses({ complete: () => null });

    const results = await runCallback({
        designAnalyses,
        payload: {
            schemaVersion: "claim-typology-result/v1",
            status:        "completed",
            clientContext: CLIENT_CONTEXT,
            claimTypology: TYPOLOGY_DOCUMENT,
        },
    });

    assert.equal(results[0].status, "skipped");
});

test("callback-received: records a failed result as service-<code> with its message", async () => {
    const { designAnalyses, calls } = makeDesignAnalyses();

    const results = await runCallback({
        designAnalyses,
        payload: {
            schemaVersion: "claim-typology-result/v1",
            taskId:        "task-1",
            status:        "failed",
            clientContext: CLIENT_CONTEXT,
            error:         { code: "llm_refused", message: "The model refused the request." },
        },
    });

    assert.deepEqual(calls, [{
        name: "fail",
        args: {
            jobId:        JOB_ID,
            errorCode:    "service-llm-refusal",
            errorMessage: "The model refused the request.",
        },
    }]);
    assert.equal(results[0].status, "failed");
});

test("callback-received: fails a result that is not a claim typology", async () => {
    const payloads = [
        {},
        { schemaVersion: "claim-typology-result/v1", status: "completed" },
        {
            schemaVersion: "claim-typology-result/v1",
            status:        "completed",
            claimTypology: { ...TYPOLOGY_DOCUMENT, schemaVersion: "other/v1" },
        },
        {
            schemaVersion: "claim-typology-result/v1",
            status:        "completed",
            claimTypology: { ...TYPOLOGY_DOCUMENT, typologies: [{ questionId: 3, types: [] }] },
        },
    ];

    for (const payload of payloads) {
        const { designAnalyses, calls } = makeDesignAnalyses();
        await runCallback({ designAnalyses, payload });
        assert.equal(calls[0].name, "fail");
        assert.equal(calls[0].args.errorCode, "invalid-result");
    }
});

test("callback-received: skips a callback that matches no job", async () => {
    const { designAnalyses, calls } = makeDesignAnalyses();

    const results = await runCallback({ designAnalyses, jobId: null, payload: {} });

    assert.equal(calls.length, 0);
    assert.equal(results[0].status, "skipped");
});

test("annotateTypology: keeps the typology and adds its question text hash", () => {
    const typology = TYPOLOGY_DOCUMENT.typologies[0];

    assert.deepEqual(annotateTypology(typology, { "p1-q1": "sha256:x" }), {
        ...typology, questionTextHash: "sha256:x",
    });
    assert.equal(annotateTypology(typology, null).questionTextHash, null);
    assert.equal(annotateTypology(typology, { "p1-q1": 7 }).questionTextHash, null);
});

test("getUiTranslations: Spanish and English texts", async () => {
    const translations = await getUiTranslations();

    assert.deepEqual(Object.keys(translations).sort(), ["en_US", "es_CL"]);
    for (const locale of ["es_CL", "en_US"]) {
        assert.ok(translations[locale].label);
        assert.ok(translations[locale].description);
        assert.ok(translations[locale].tabTitle);
    }
});

test("serviceFailure: public and core codes map to service-<code>; unknown ones are internal", () => {
    const cases = [
        ["llm_error", "service-llm-error"],
        ["llm_request_failed", "service-llm-error"],
        ["llm_refusal", "service-llm-refusal"],
        ["llm_refused", "service-llm-refusal"],
        ["invalid_output", "service-invalid-output"],
        ["llm_output_truncated", "service-invalid-output"],
        ["timeout", "service-timeout"],
        ["worker_lost", "service-worker-lost"],
        ["internal_error", "service-internal-error"],
    ];
    for (const [code, errorCode] of cases) {
        assert.deepEqual(serviceFailure({ code, message: " Sanitized. " }), {
            errorCode, errorMessage: "Sanitized.",
        });
    }

    assert.deepEqual(serviceFailure({ code: "toString", message: "Odd." }), {
        errorCode: "service-internal-error", errorMessage: "Odd. (toString)",
    });
    assert.equal(serviceFailure(null).errorCode, "service-internal-error");
    assert.equal(serviceFailure(null).errorMessage, "Case Analyst could not generate the claim typology.");
});

test("requestFailure: 4xx is rejected; no connection, network and 5xx failed", () => {
    assert.equal(requestFailure({ statusCode: 404 }).errorCode, "request-rejected");
    assert.equal(requestFailure({ statusCode: 500 }).errorCode, "request-failed");
    assert.equal(requestFailure(new AiAdditionsNotConfiguredError()).errorMessage,
        "The AI Additions connection is not configured.");
    assert.equal(requestFailure(new Error("socket hang up")).errorMessage,
        "Case Analyst could not be reached.");
});

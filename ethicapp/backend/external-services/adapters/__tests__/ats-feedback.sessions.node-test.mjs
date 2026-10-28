// One tutor session per question (#850), in the enhanced mode when the case
// has an evidence inventory and the question an up-to-date claim typology,
// otherwise in the basic mode (#865). The adapter runs with a fake AI
// Additions client, a fake registry and fake database reads: differential 101
// and 102 are the first and second questions of phase 2.
import assert from "node:assert/strict";
import test from "node:test";

import { sha256Text } from "../../../helpers/analysis-input-hash.js";
import { loadTutorModeInputs } from "../../../helpers/tutor-mode.js";
import * as atsFeedback from "../ats-feedback.adapter.js";

const Q1 = "Should Sebastián tell his mother?";
const Q2 = "What should the school do?";

const DESIGN = Object.freeze({
    type:   "semantic_differential",
    phases: [
        { questions: [{ q_text: "Warm-up without the tutor." }] },
        {
            instructions:     "Answer both questions.",
            externalServices: { enabledServiceIds: ["argumentation-tutor-system"] },
            questions:        [{ q_text: Q1 }, { q_text: Q2 }],
        },
    ],
});

const POSITIONS = Object.freeze({
    101: { phaseNumber: 2, questionNumber: 1 },
    102: { phaseNumber: 2, questionNumber: 2 },
});

function typologyFor(questionId, text, focalAction) {
    return {
        questionId,
        phaseId:          2,
        focalAction,
        questionTextHash: sha256Text(text),
        types:            [{
            id:                 "AF1",
            label:              "Tell her",
            description:        "Argues for telling.",
            stance:             "in_favor",
            relatedEvidenceIds: ["EV1"],
        }],
    };
}

const TYPOLOGY_DOCUMENT = Object.freeze({
    schemaVersion: "claim-typology/v1",
    typologies:    [
        typologyFor("p2-q1", Q1, "tell his mother"),
        // Generated for an earlier text of the second question.
        typologyFor("p2-q2", "What should the teacher do?", "act as a teacher"),
    ],
});

const INVENTORY = Object.freeze({
    schemaVersion: "evidence-inventory/v1",
    kind:          "case_evidence_inventory",
    language:      "en_US",
    facts:         [{ id: "EV1", statement: "His mother is ill." }],
    exclusions:    [],
});

const INVENTORY_ID = "case-analyst-evidence-inventory";
const TYPOLOGY_ID = "case-analyst-claim-typology";

function fakeTutor({ rejectContext = false, ignoreContext = false } = {}) {
    const requests = [];
    let sessions = 0;
    let tasks = 0;

    const client = {
        getEndpoints: async () => ({}),
        requestJson:  async (pathname, { method, body, basePath }) => {
            requests.push({ pathname, method, body, basePath });

            if (pathname === "/sessions" && method === "POST") {
                if (body.case_context && body.claim_typology) {
                    throw badRequest({ error: "Invalid case context", errors: [{ path: "/" }] });
                }
                if (rejectContext && body.case_context) {
                    throw badRequest({
                        error:  "Invalid case context",
                        errors: [{ path: "/evidenceInventory/facts/0/id", message: "bad" }],
                    });
                }
                if (body.evaluation_mode === "basic" && body.case_context) {
                    throw badRequest({
                        error:  "Conflicting evaluation mode",
                        errors: { evaluation_mode: "basic never uses a case context" },
                    });
                }
                sessions += 1;
                const session = { session_id: `ats-${sessions}`, warnings: [], degraded: false };
                if (body.evaluation_mode) {
                    // ethicapp-ai-additions#211: the requested mode narrows the
                    // mode the context selects.
                    const enhanced = body.evaluation_mode === "enhanced" && Boolean(body.case_context);
                    Object.assign(session, {
                        requestedMode: body.evaluation_mode,
                        mode:          enhanced ? "enhanced" : "basic",
                        ...(enhanced ? {} : {
                            missing: body.evaluation_mode === "basic"
                                ? []
                                : ["evidenceInventory", "claimTypology"],
                        }),
                    });
                } else if (body.case_context && ignoreContext) {
                    // A tutor that predates ethicapp-ai-additions#209.
                    session.warnings.push({
                        field: "case_context", verdict: "unsupported", message: "unknown",
                    });
                    session.degraded = true;
                } else if (body.case_context) {
                    session.mode = "enhanced";
                }
                return session;
            }
            if (method === "DELETE") {
                return {};
            }

            tasks += 1;
            return { task_id: `task-${tasks}` };
        },
    };

    return { client, requests };
}

function badRequest(responseBody) {
    const error = new Error("HTTP 400");
    error.statusCode = 400;
    error.responseBody = responseBody;
    return error;
}

// The registry the tutor mode reads: which of the two analysis adapters the
// session's pinned policy version allows, and the tutor's descriptor fields
// (`evaluation_mode` only with `declaresEvaluationMode`, #870).
function fakeRegistry(usable = [INVENTORY_ID, TYPOLOGY_ID], { declaresEvaluationMode = false } = {}) {
    const calls = [];
    const fields = [{ key: "llm_tier" }, ...(declaresEvaluationMode ? [{ key: "evaluation_mode" }] : [])];
    return {
        calls,
        async getSessionPolicyVersion(sessionId) {
            calls.push({ sessionId });
            return { id: 3 };
        },
        async usableServiceIds(serviceIds, options) {
            calls.push({ serviceIds, options });
            return serviceIds.filter(id => usable.includes(id));
        },
        async getServiceInstanceConfiguration(serviceId, locale, options) {
            calls.push({ descriptor: serviceId, options });
            return { available: true, stale: false, fields };
        },
    };
}

// A tutor with ethicapp-ai-additions#211, which declares evaluation_mode.
function modeAwareRegistry(usable = [INVENTORY_ID, TYPOLOGY_ID]) {
    return fakeRegistry(usable, { declaresEvaluationMode: true });
}

async function registerAdapter({
    tutor,
    typologyDocument = TYPOLOGY_DOCUMENT,
    typologyStatus = "ready",
    inventoryRow = { status: "ready", document: INVENTORY },
    registry = fakeRegistry(),
    now = () => 0,
}) {
    const subscribers = new Map();
    const published = [];

    await atsFeedback.register({
        subscribe:               (hookName, handler) => subscribers.set(hookName, handler),
        publishStudentResult:    async payload => { published.push(payload); return true; },
        aiAdditionsClient:       tutor.client,
        atsFeedbackDependencies: {
            resolveGroupId:          async () => 7,
            resolveQuestionPosition: async context => POSITIONS[context.questionId]
                ?? { phaseNumber: 2, questionNumber: null },
            loadSessionContext: async () => ({
                sessionTitle:       "Activity",
                sessionDescription: "",
                designId:           12,
                design:             DESIGN,
                caseId:             34,
                caseText:           "Case text.",
            }),
            resolveQuestionText: async context => `Runtime question ${context.questionId}`,
            loadTutorModeInputs: args => loadTutorModeInputs(args, {
                registry,
                getDesignAnalysisRow: async () => (typologyDocument
                    ? { status: typologyStatus, is_stale: false, document: typologyDocument }
                    : null),
                getCaseAnalysisRow: async () => inventoryRow,
            }),
            now,
        },
    });

    async function dispatch(hookName, context) {
        const callbacks = [];
        const reports = [];
        await subscribers.get(hookName)(context, {
            callback:            async result => { callbacks.push(result); },
            reportInstantiation: async report => { reports.push(report); },
        });
        return { callbacks, reports };
    }

    return { dispatch, published };
}

// `serviceConfiguration` is the phase's configuration of the tutor, as the
// registry passes it to the handler (#734).
function response(questionId, userId, comment, serviceConfiguration = {}) {
    return {
        sessionId:       5,
        phaseId:         20,
        questionId,
        userId,
        designType:      "semantic_differential",
        correlationId:   `job-${questionId}-${userId}`,
        responsePayload: { comment },
        serviceConfiguration,
    };
}

function sessionCreations(requests) {
    return requests.filter(request => request.pathname === "/sessions" && request.method === "POST");
}

async function quietly(run) {
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => { warnings.push(args); };
    try {
        return { result: await run(), warnings };
    } finally {
        console.warn = originalWarn;
    }
}

test("each question of a phase has its own tutor session, with its own text", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor, typologyDocument: null });

    await dispatch("student-response-submitted", response(101, 1, "First answer to Q1."));
    await dispatch("student-response-submitted", response(102, 1, "First answer to Q2."));
    await dispatch("student-response-submitted", response(101, 2, "Another student on Q1."));

    const creations = sessionCreations(tutor.requests);
    assert.deepEqual(creations.map(request => request.body.question), [Q1, Q2]);
    assert.ok(creations.every(request => request.body.case_text === "Case text."));

    const submissions = tutor.requests.filter(request => request.pathname.endsWith("/arguments"));
    assert.deepEqual(submissions.map(request => request.pathname), [
        "/sessions/ats-1/arguments",
        "/sessions/ats-2/arguments",
        "/sessions/ats-1/arguments",
    ]);
    assert.equal(submissions[1].body.client_context.questionId, 102);
});

test("a later answer to the same question is compared in that question's session", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor, typologyDocument: null });

    await dispatch("student-response-submitted", response(101, 1, "Q1, first."));
    await dispatch("student-response-submitted", response(102, 1, "Q2, first."));
    await dispatch("student-response-submitted", response(101, 1, "Q1, revised."));

    const paths = tutor.requests.map(request => request.pathname);
    assert.deepEqual(paths, [
        "/sessions",
        "/sessions/ats-1/arguments",
        "/sessions",
        "/sessions/ats-2/arguments",
        "/sessions/ats-1/arguments/compare",
    ]);
});

test("an up-to-date typology and an inventory open an enhanced session with case_context", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor });

    const first = await dispatch("student-response-submitted", response(101, 1, "Q1."));
    const second = await dispatch("student-response-submitted", response(102, 1, "Q2."));

    const [enhanced, basic] = sessionCreations(tutor.requests);
    assert.deepEqual(enhanced.body.case_context, {
        schemaVersion:     "tutor-case-context/v1",
        evidenceInventory: INVENTORY,
        claimTypology:     {
            schemaVersion: "tutor-claim-typology/v1",
            focalAction:   "tell his mother",
            types:         [{
                id:                 "AF1",
                label:              "Tell her",
                description:        "Argues for telling.",
                stance:             "in_favor",
                relatedEvidenceIds: ["EV1"],
            }],
        },
    });
    assert.equal(Object.hasOwn(enhanced.body, "claim_typology"), false,
        "the deprecated claim_typology is never sent");
    assert.equal(Object.hasOwn(basic.body, "case_context"), false,
        "a basic session receives no context");
    assert.equal(Object.hasOwn(basic.body, "claim_typology"), false);

    assert.equal(first.reports[0].questionKey, "p2-q1");
    assert.equal(first.reports[0].tutorMode, "enhanced");
    assert.equal(first.reports[0].tutorModeReason, null);
    assert.equal(first.reports[0].caseContext, "used");
    assert.equal(second.reports[0].questionKey, "p2-q2");
    assert.equal(second.reports[0].tutorMode, "basic",
        "questions of one phase can differ");
    assert.equal(second.reports[0].tutorModeReason, "typology-out-of-date");
    assert.equal(Object.hasOwn(second.reports[0], "caseContext"), false);
});

test("the session follows the policy version it is pinned to", async () => {
    const tutor = fakeTutor();
    const registry = fakeRegistry();
    const { dispatch } = await registerAdapter({ tutor, registry });

    await dispatch("student-response-submitted", response(101, 1, "Q1."));

    assert.deepEqual(registry.calls, [
        { sessionId: 5 },
        { serviceIds: [INVENTORY_ID, TYPOLOGY_ID], options: { policyVersion: { id: 3 } } },
        { descriptor: "argumentation-tutor-system", options: { policyVersion: { id: 3 } } },
    ]);
});

test("each missing or failed input opens a basic session with its reason", async () => {
    const cases = [
        { name: "no inventory", options: { inventoryRow: null }, reason: "no-inventory" },
        {
            name:    "failed inventory",
            options: { inventoryRow: { status: "failed", document: null } },
            reason:  "inventory-failed",
        },
        {
            name:    "inventory switched off",
            options: { registry: fakeRegistry([TYPOLOGY_ID]) },
            reason:  "inventory-disabled",
        },
        { name: "no typology analysis", options: { typologyDocument: null }, reason: "no-typology" },
        {
            name:    "pending typology",
            options: { typologyDocument: { ...TYPOLOGY_DOCUMENT, typologies: [] }, typologyStatus: "processing" },
            reason:  "typology-pending",
        },
        {
            name:    "failed typology",
            options: { typologyDocument: { ...TYPOLOGY_DOCUMENT, typologies: [] }, typologyStatus: "failed" },
            reason:  "typology-failed",
        },
        {
            name:    "typology switched off",
            options: { registry: fakeRegistry([INVENTORY_ID]) },
            reason:  "typology-disabled",
        },
    ];

    for (const { name, options, reason } of cases) {
        const tutor = fakeTutor();
        const { dispatch } = await registerAdapter({ tutor, ...options });

        const { reports } = await dispatch("student-response-submitted", response(101, 1, "Q1."));

        const [creation] = sessionCreations(tutor.requests);
        assert.deepEqual(Object.keys(creation.body).sort(),
            ["case_id", "case_text", "case_title", "question"], name);
        assert.equal(reports[0].tutorMode, "basic", name);
        assert.equal(reports[0].tutorModeReason, reason, name);
    }
});

test("a question outside the design's tutor questions uses its runtime text", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor });

    const { reports } = await dispatch("student-response-submitted", response(999, 1, "Answer."));

    const [creation] = sessionCreations(tutor.requests);
    assert.equal(creation.body.question, "Runtime question 999");
    assert.equal(Object.hasOwn(creation.body, "case_context"), false);
    assert.equal(reports[0].questionKey, "question-999");
    assert.equal(reports[0].tutorMode, "basic");
    assert.equal(reports[0].tutorModeReason, "no-typology");
});

test("a failure to read the inputs opens a basic session", async () => {
    const tutor = fakeTutor();
    const subscribers = new Map();
    await atsFeedback.register({
        subscribe:               (hookName, handler) => subscribers.set(hookName, handler),
        publishStudentResult:    async () => true,
        aiAdditionsClient:       tutor.client,
        atsFeedbackDependencies: {
            resolveGroupId:          async () => 7,
            resolveQuestionPosition: async () => POSITIONS[101],
            loadSessionContext:      async () => ({ designId: 12, design: DESIGN, caseId: 34 }),
            resolveQuestionText:     async () => "",
            loadTutorModeInputs:     async () => { throw new Error("policy unavailable"); },
        },
    });

    const reports = [];
    const { warnings } = await quietly(() => subscribers.get("student-response-submitted")(
        response(101, 1, "Q1."),
        { callback: async () => {}, reportInstantiation: async report => { reports.push(report); } }
    ));

    assert.equal(sessionCreations(tutor.requests).length, 1);
    assert.equal(reports[0].tutorMode, "basic");
    assert.equal(reports[0].tutorModeReason, "inventory-failed");
    assert.equal(warnings.length, 1);
});

test("a tutor that rejects the context gets the session without it, logged once", async () => {
    const tutor = fakeTutor({ rejectContext: true });
    const { dispatch } = await registerAdapter({
        tutor,
        typologyDocument: {
            ...TYPOLOGY_DOCUMENT,
            typologies: [
                typologyFor("p2-q1", Q1, "tell his mother"),
                typologyFor("p2-q2", Q2, "act as a school"),
            ],
        },
    });

    const { result, warnings } = await quietly(async () => [
        await dispatch("student-response-submitted", response(101, 1, "Q1.")),
        await dispatch("student-response-submitted", response(102, 1, "Q2.")),
    ]);

    const creations = sessionCreations(tutor.requests);
    assert.equal(creations.length, 4, "each question tries with the context, then without it");
    assert.equal(Object.hasOwn(creations[1].body, "case_context"), false);
    assert.deepEqual(result.map(({ reports }) => reports[0].tutorModeReason),
        ["context-rejected", "context-rejected"]);
    assert.deepEqual(result.map(({ reports }) => reports[0].caseContext), ["rejected", "rejected"]);
    assert.equal(result[0].reports[0].caseContextRejection.error, "Invalid case context");
    assert.deepEqual(result.map(({ callbacks }) => callbacks.length), [0, 0],
        "the jobs stay dispatched until the tutor's callbacks");
    assert.equal(warnings.length, 1);
});

test("a tutor without context support is not offered one again for a while", async () => {
    let clock = 0;
    const tutor = fakeTutor({ ignoreContext: true });
    const { dispatch } = await registerAdapter({
        tutor,
        now:              () => clock,
        typologyDocument: {
            ...TYPOLOGY_DOCUMENT,
            typologies: [
                typologyFor("p2-q1", Q1, "tell his mother"),
                typologyFor("p2-q2", Q2, "act as a school"),
            ],
        },
    });

    const { result: [first, second], warnings } = await quietly(async () => [
        await dispatch("student-response-submitted", response(101, 1, "Q1.")),
        await dispatch("student-response-submitted", response(102, 1, "Q2.")),
    ]);

    assert.equal(first.reports[0].caseContext, "unsupported");
    assert.equal(first.reports[0].tutorModeReason, "tutor-unsupported");
    assert.equal(Object.hasOwn(second.reports[0], "caseContext"), false, "withheld, not offered");
    assert.equal(second.reports[0].tutorModeReason, "tutor-unsupported");
    assert.equal(Object.hasOwn(sessionCreations(tutor.requests)[1].body, "case_context"), false);
    assert.equal(warnings.length, 1);

    clock = atsFeedback.CASE_CONTEXT_UNSUPPORTED_RETRY_MS;
    await quietly(() => dispatch("phase-ended", { sessionId: 5, phaseId: 20 }));
    await quietly(() => dispatch("student-response-submitted", response(101, 1, "Q1 again.")));
    assert.ok(sessionCreations(tutor.requests)[2].body.case_context,
        "the context is offered again once the window has passed");
});

test("a running session keeps its mode", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor, inventoryRow: null });

    const first = await dispatch("student-response-submitted", response(101, 1, "Q1."));
    const later = await dispatch("student-response-submitted", response(101, 2, "Another student."));

    assert.equal(first.reports[0].tutorModeReason, "no-inventory");
    assert.equal(later.reports.length, 0, "no new session, no new report");
    assert.equal(sessionCreations(tutor.requests).length, 1);
});

test("phase-ended deletes the tutor session of every question of the phase", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor, typologyDocument: null });

    await dispatch("student-response-submitted", response(101, 1, "Q1."));
    await dispatch("student-response-submitted", response(102, 1, "Q2."));
    const { callbacks } = await dispatch("phase-ended", { sessionId: 5, phaseId: 20 });

    const deletions = tutor.requests.filter(request => request.method === "DELETE");
    assert.deepEqual(deletions.map(request => request.pathname).sort(),
        ["/sessions/ats-1", "/sessions/ats-2"]);
    assert.equal(callbacks[0].status, "completed");
    assert.equal(callbacks[0].payload.clearedAtsSessions, 2);
    assert.equal(callbacks[0].payload.clearedSubmissionCounters, 2);

    await dispatch("student-response-submitted", response(101, 1, "Q1 after the phase."));
    assert.equal(sessionCreations(tutor.requests).length, 3, "a new session after the phase ended");
});

test("findTutorQuestion: the question unit at a position of a tutor phase (#863)", () => {
    assert.deepEqual(atsFeedback.findTutorQuestion(DESIGN, POSITIONS[102]), {
        id:             "p2-q2",
        phaseNumber:    2,
        questionNumber: 2,
        text:           Q2,
        textHash:       sha256Text(Q2),
    });
    assert.equal(atsFeedback.findTutorQuestion(DESIGN, { phaseNumber: 1, questionNumber: 1 }), null,
        "a phase without the tutor has no tutor question");
    assert.equal(atsFeedback.findTutorQuestion(null, POSITIONS[101]), null);
});

test("the evaluation's claim type, mode and evidence are recorded with the result, not sent to the student", async () => {
    const tutor = fakeTutor();
    const { dispatch, published } = await registerAdapter({ tutor });

    const { callbacks } = await dispatch("callback-received", {
        requestPayload: {
            sessionId:          5,
            phaseId:            20,
            questionId:         101,
            groupId:            7,
            userId:             1,
            summary:            "Good argument.",
            claimTypeId:        "AF1",
            claimTypeRationale: "Argues for telling his mother.",
            tutorMode:          "enhanced",
            evidenceFactIds:    ["EV1"],
            unsupportedClaims:  [{ statement: "She will be fired.", exclusionId: "EX1" }],
        },
    });

    assert.equal(callbacks[0].status, "completed");
    assert.equal(callbacks[0].payload.claimTypeId, "AF1");
    assert.equal(callbacks[0].payload.claimTypeRationale, "Argues for telling his mother.");
    assert.equal(callbacks[0].payload.tutorMode, "enhanced");
    assert.deepEqual(callbacks[0].payload.evidenceFactIds, ["EV1"]);
    assert.deepEqual(callbacks[0].payload.unsupportedClaims,
        [{ statement: "She will be fired.", exclusionId: "EX1" }]);
    const studentPayload = JSON.stringify(published);
    for (const key of ["claimType", "tutorMode", "evidenceFactIds", "unsupportedClaims"]) {
        assert.equal(studentPayload.includes(key), false, key);
    }

    const withoutType = await dispatch("callback-received", {
        requestPayload: { sessionId: 5, phaseId: 20, questionId: 101, groupId: 7, userId: 1 },
    });
    assert.equal(Object.hasOwn(withoutType.callbacks[0].payload, "claimTypeId"), false);
    assert.equal(Object.hasOwn(withoutType.callbacks[0].payload, "tutorMode"), false);
});

// ─── The phase's requested mode (#870) ───────────────────────────────────────

const BASIC_PHASE = Object.freeze({ evaluation_mode: "basic" });
const ENHANCED_PHASE = Object.freeze({ evaluation_mode: "enhanced" });

test("a phase set to basic opens basic sessions with basic-selected, no context and evaluation_mode", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor, registry: modeAwareRegistry() });

    const first = await dispatch("student-response-submitted", response(101, 1, "Q1.", BASIC_PHASE));
    const second = await dispatch("student-response-submitted", response(102, 1, "Q2.", BASIC_PHASE));

    for (const creation of sessionCreations(tutor.requests)) {
        assert.equal(creation.body.evaluation_mode, "basic");
        assert.equal(Object.hasOwn(creation.body, "case_context"), false,
            "a basic phase sends no context, though Q1 has a usable typology");
        assert.equal(Object.hasOwn(creation.body, "claim_typology"), false);
    }
    for (const { reports } of [first, second]) {
        assert.equal(reports[0].tutorMode, "basic");
        assert.equal(reports[0].tutorModeReason, "basic-selected");
        assert.equal(reports[0].requestedMode, "basic");
        assert.equal(reports[0].tutorRequestedMode, "basic", "the tutor reports the requested mode");
        assert.equal(Object.hasOwn(reports[0], "caseContext"), false);
        assert.equal(Object.hasOwn(reports[0], "tutorModeMissing"), false);
    }
});

test("a phase set to enhanced, or without a value, behaves as in #869 and sends evaluation_mode", async () => {
    for (const configuration of [ENHANCED_PHASE, {}, { evaluation_mode: " Enhanced " }]) {
        const tutor = fakeTutor();
        const { dispatch } = await registerAdapter({ tutor, registry: modeAwareRegistry() });

        const first = await dispatch("student-response-submitted", response(101, 1, "Q1.", configuration));
        const second = await dispatch("student-response-submitted", response(102, 1, "Q2.", configuration));

        const [enhanced, basic] = sessionCreations(tutor.requests);
        const name = JSON.stringify(configuration);
        assert.equal(enhanced.body.evaluation_mode, "enhanced", name);
        assert.equal(enhanced.body.case_context.schemaVersion, "tutor-case-context/v1", name);
        assert.equal(basic.body.evaluation_mode, "enhanced", name);
        assert.equal(Object.hasOwn(basic.body, "case_context"), false, name);

        assert.equal(first.reports[0].tutorMode, "enhanced", name);
        assert.equal(first.reports[0].tutorModeReason, null, name);
        assert.equal(first.reports[0].requestedMode, "enhanced", name);
        assert.equal(first.reports[0].caseContext, "used", name);
        assert.equal(second.reports[0].tutorMode, "basic", name);
        assert.equal(second.reports[0].tutorModeReason, "typology-out-of-date", name);
        assert.equal(second.reports[0].requestedMode, "enhanced", name);
        assert.deepEqual(second.reports[0].tutorModeMissing, ["evidenceInventory", "claimTypology"], name);
    }
});

test("a phase set to enhanced keeps every fallback reason of #869", async () => {
    const cases = [
        { options: { inventoryRow: null }, reason: "no-inventory" },
        { options: { inventoryRow: { status: "failed", document: null } }, reason: "inventory-failed" },
        { options: { registry: modeAwareRegistry([TYPOLOGY_ID]) }, reason: "inventory-disabled" },
        { options: { typologyDocument: null }, reason: "no-typology" },
        {
            options: { typologyDocument: { ...TYPOLOGY_DOCUMENT, typologies: [] }, typologyStatus: "processing" },
            reason:  "typology-pending",
        },
        {
            options: { typologyDocument: { ...TYPOLOGY_DOCUMENT, typologies: [] }, typologyStatus: "failed" },
            reason:  "typology-failed",
        },
        { options: { registry: modeAwareRegistry([INVENTORY_ID]) }, reason: "typology-disabled" },
    ];

    for (const { options, reason } of cases) {
        const tutor = fakeTutor();
        const { dispatch } = await registerAdapter({ tutor, registry: modeAwareRegistry(), ...options });

        const { reports } = await dispatch("student-response-submitted", response(101, 1, "Q1.", ENHANCED_PHASE));

        const [creation] = sessionCreations(tutor.requests);
        assert.deepEqual(Object.keys(creation.body).sort(),
            ["case_id", "case_text", "case_title", "evaluation_mode", "question"], reason);
        assert.equal(creation.body.evaluation_mode, "enhanced", reason);
        assert.equal(reports[0].tutorMode, "basic", reason);
        assert.equal(reports[0].tutorModeReason, reason, reason);
        assert.equal(reports[0].requestedMode, "enhanced", reason);
    }
});

test("a tutor whose descriptor does not declare evaluation_mode is not sent it", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor, registry: fakeRegistry() });

    const basic = await dispatch("student-response-submitted", response(101, 1, "Q1.", BASIC_PHASE));
    const enhanced = await dispatch("student-response-submitted", response(102, 1, "Q2.", ENHANCED_PHASE));

    const creations = sessionCreations(tutor.requests);
    assert.ok(creations.every(creation => !Object.hasOwn(creation.body, "evaluation_mode")));
    assert.equal(Object.hasOwn(creations[0].body, "case_context"), false, "basic still sends no context");
    assert.equal(basic.reports[0].tutorModeReason, "basic-selected");
    assert.equal(basic.reports[0].requestedMode, "basic");
    assert.equal(Object.hasOwn(basic.reports[0], "tutorRequestedMode"), false);
    assert.equal(enhanced.reports[0].tutorModeReason, "typology-out-of-date");
    assert.equal(enhanced.reports[0].requestedMode, "enhanced");
});

test("a failure to read the inputs keeps the phase's requested mode", async () => {
    const tutor = fakeTutor();
    const subscribers = new Map();
    await atsFeedback.register({
        subscribe:               (hookName, handler) => subscribers.set(hookName, handler),
        publishStudentResult:    async () => true,
        aiAdditionsClient:       tutor.client,
        atsFeedbackDependencies: {
            resolveGroupId:          async () => 7,
            resolveQuestionPosition: async () => POSITIONS[101],
            loadSessionContext:      async () => ({ designId: 12, design: DESIGN, caseId: 34 }),
            resolveQuestionText:     async () => "",
            loadTutorModeInputs:     async () => { throw new Error("policy unavailable"); },
        },
    });

    const reports = [];
    await quietly(() => subscribers.get("student-response-submitted")(
        response(101, 1, "Q1.", BASIC_PHASE),
        { callback: async () => {}, reportInstantiation: async report => { reports.push(report); } }
    ));

    assert.equal(reports[0].tutorModeReason, "basic-selected");
    assert.equal(reports[0].requestedMode, "basic");
    assert.equal(Object.hasOwn(sessionCreations(tutor.requests)[0].body, "evaluation_mode"), false,
        "the descriptor was not read, so the field is not sent");
});

test("the evaluation's requested mode is recorded with the result", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor });

    const { callbacks } = await dispatch("callback-received", {
        requestPayload: {
            sessionId:     5,
            phaseId:       20,
            questionId:    101,
            groupId:       7,
            userId:        1,
            summary:       "Fine.",
            tutorMode:     "basic",
            requestedMode: "basic",
        },
    });

    assert.equal(callbacks[0].payload.tutorMode, "basic");
    assert.equal(callbacks[0].payload.requestedMode, "basic");
});

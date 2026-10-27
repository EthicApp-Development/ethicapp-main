// One tutor session per question, with that question's claim typology (#850).
// The adapter runs with a fake AI Additions client and fake database reads:
// differential 101 and 102 are the first and second questions of phase 2.
import assert from "node:assert/strict";
import test from "node:test";

import { sha256Text } from "../../../helpers/analysis-input-hash.js";
import { loadTutorClaimTypology } from "../../../helpers/tutor-claim-typology.js";
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
    facts:         [{ id: "EV1", statement: "His mother is ill." }],
});

function fakeTutor({ rejectTypology = false, ignoreTypology = false } = {}) {
    const requests = [];
    let sessions = 0;
    let tasks = 0;

    const client = {
        getEndpoints: async () => ({}),
        requestJson:  async (pathname, { method, body, basePath }) => {
            requests.push({ pathname, method, body, basePath });

            if (pathname === "/sessions" && method === "POST") {
                if (rejectTypology && body.claim_typology) {
                    const error = new Error("HTTP 400");
                    error.statusCode = 400;
                    error.responseBody = { error: "Invalid claim typology", errors: ["types"] };
                    throw error;
                }
                sessions += 1;
                const session = { session_id: `ats-${sessions}`, warnings: [], degraded: false };
                if (body.claim_typology && ignoreTypology) {
                    // A tutor that predates ethicapp-ai-additions#204.
                    session.warnings.push({
                        field: "claim_typology", verdict: "unsupported", message: "unknown",
                    });
                    session.degraded = true;
                } else if (body.claim_typology) {
                    session.claim_typology_used = true;
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

async function registerAdapter({ tutor, typologyDocument = TYPOLOGY_DOCUMENT, now = () => 0 }) {
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
            loadClaimTypology:   args => loadTutorClaimTypology(args, {
                getAnalysis: async () => (typologyDocument
                    ? { status: "ready", document: typologyDocument }
                    : null),
                getCaseAnalysisRow: async () => ({ document: INVENTORY }),
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

function response(questionId, userId, comment) {
    return {
        sessionId:       5,
        phaseId:         20,
        questionId,
        userId,
        designType:      "semantic_differential",
        correlationId:   `job-${questionId}-${userId}`,
        responsePayload: { comment },
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

test("a question with an up-to-date typology gets it; an out-of-date one does not", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor });

    const first = await dispatch("student-response-submitted", response(101, 1, "Q1."));
    const second = await dispatch("student-response-submitted", response(102, 1, "Q2."));

    const [withTypology, withoutTypology] = sessionCreations(tutor.requests);
    assert.deepEqual(withTypology.body.claim_typology, {
        schemaVersion: "tutor-claim-typology/v1",
        focalAction:   "tell his mother",
        types:         [{
            id:                 "AF1",
            label:              "Tell her",
            description:        "Argues for telling.",
            stance:             "in_favor",
            relatedEvidenceIds: ["EV1"],
        }],
        relatedFacts: [{ id: "EV1", statement: "His mother is ill." }],
    });
    assert.equal(Object.hasOwn(withoutTypology.body, "claim_typology"), false);

    assert.equal(first.reports[0].questionKey, "p2-q1");
    assert.equal(first.reports[0].claimTypology, "used");
    assert.equal(second.reports[0].claimTypology, "absent");
    assert.equal(second.reports[0].claimTypologyReason, "out-of-date");
});

test("without a typology analysis the session is created as before", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor, typologyDocument: null });

    const { reports } = await dispatch("student-response-submitted", response(101, 1, "Q1."));

    const [creation] = sessionCreations(tutor.requests);
    assert.deepEqual(Object.keys(creation.body).sort(),
        ["case_id", "case_text", "case_title", "question"]);
    assert.equal(reports[0].claimTypology, "absent");
    assert.equal(reports[0].claimTypologyReason, "no-analysis");
});

test("a question outside the design's tutor questions uses its runtime text", async () => {
    const tutor = fakeTutor();
    const { dispatch } = await registerAdapter({ tutor });

    const { reports } = await dispatch("student-response-submitted", response(999, 1, "Answer."));

    const [creation] = sessionCreations(tutor.requests);
    assert.equal(creation.body.question, "Runtime question 999");
    assert.equal(Object.hasOwn(creation.body, "claim_typology"), false);
    assert.equal(reports[0].questionKey, "question-999");
    assert.equal(reports[0].claimTypologyReason, "no-question");
});

test("a tutor that rejects the typology gets the session without it, logged once", async () => {
    const tutor = fakeTutor({ rejectTypology: true });
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
    assert.equal(creations.length, 4, "each question tries with the typology, then without it");
    assert.equal(Object.hasOwn(creations[1].body, "claim_typology"), false);
    assert.deepEqual(result.map(({ reports }) => reports[0].claimTypology), ["rejected", "rejected"]);
    assert.deepEqual(result.map(({ callbacks }) => callbacks.length), [0, 0],
        "the jobs stay dispatched until the tutor's callbacks");
    assert.equal(warnings.length, 1);
});

test("a tutor without typology support is not offered one again for a while", async () => {
    let clock = 0;
    const tutor = fakeTutor({ ignoreTypology: true });
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

    assert.equal(first.reports[0].claimTypology, "unsupported");
    assert.equal(second.reports[0].claimTypology, "withheld");
    assert.equal(Object.hasOwn(sessionCreations(tutor.requests)[1].body, "claim_typology"), false);
    assert.equal(warnings.length, 1);

    clock = atsFeedback.CLAIM_TYPOLOGY_UNSUPPORTED_RETRY_MS;
    await quietly(() => dispatch("phase-ended", { sessionId: 5, phaseId: 20 }));
    await quietly(() => dispatch("student-response-submitted", response(101, 1, "Q1 again.")));
    assert.ok(sessionCreations(tutor.requests)[2].body.claim_typology,
        "the typology is offered again once the window has passed");
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

test("the tutor's matched claim type is recorded with the result, not sent to the student", async () => {
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
        },
    });

    assert.equal(callbacks[0].status, "completed");
    assert.equal(callbacks[0].payload.claimTypeId, "AF1");
    assert.equal(callbacks[0].payload.claimTypeRationale, "Argues for telling his mother.");
    assert.equal(JSON.stringify(published).includes("claimType"), false);

    const withoutType = await dispatch("callback-received", {
        requestPayload: { sessionId: 5, phaseId: 20, questionId: 101, groupId: 7, userId: 1 },
    });
    assert.equal(Object.hasOwn(withoutType.callbacks[0].payload, "claimTypeId"), false);
});

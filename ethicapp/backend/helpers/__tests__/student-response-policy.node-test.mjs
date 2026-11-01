// The response submission policy (#927, epic #923): one test per refusal,
// and the students it must let through, a student without a group in a team
// phase among them. The database reads are replaced by fakes over a small
// in-memory activity, so nothing here needs PostgreSQL.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    RESPONSE_REFUSAL_CODES,
    STUDENT_RESPONSE_REFUSED_EVENT,
    evaluateStudentResponse,
} from "../student-response-policy.js";

const STUDENT = 9;
const GROUPLESS_STUDENT = 14;
const OUTSIDER = 11;
const FORGOTTEN_STUDENT = 13;

const SESSION_ID = 10;
const OTHER_SESSION_ID = 20;
const UNKNOWN_SESSION_ID = 999;

const INDIVIDUAL_PHASE = 100;
const TEAM_PHASE = 101;
const QUESTION = 1;
const TEAM_QUESTION = 2;
const RANKING_ITEM = 7;

const IN_PROGRESS = 2;
const FINISHED = 3;

// The activity the fakes answer for. The team phase has a group for STUDENT
// only: GROUPLESS_STUDENT joined after the groups were formed.
function activity(overrides = {}) {
    return {
        sessions: new Map([
            [SESSION_ID, {
                status:        IN_PROGRESS,
                archived:      false,
                current_stage: INDIVIDUAL_PHASE,
                design_type:   "semantic_differential",
                participants:  [STUDENT, GROUPLESS_STUDENT, FORGOTTEN_STUDENT],
                ...overrides,
            }],
            [OTHER_SESSION_ID, {
                status:        IN_PROGRESS,
                archived:      false,
                current_stage: 200,
                design_type:   "semantic_differential",
                participants:  [OUTSIDER],
            }],
        ]),
        phases: new Map([
            [INDIVIDUAL_PHASE, { type: "individual", tasks: [QUESTION, RANKING_ITEM], groups: [] }],
            [TEAM_PHASE, { type: "team", tasks: [TEAM_QUESTION], groups: [[STUDENT]] }],
        ]),
        anonymized: new Set([FORGOTTEN_STUDENT]),
    };
}

function fakes(world = activity()) {
    const calls = { readSession: 0, findTask: [], warnings: [] };
    return {
        calls,
        dependencies: {
            // The participant rule: enrolled, with an account not anonymized.
            isParticipant: async (sessionId, userId) => !world.anonymized.has(userId)
                && (world.sessions.get(sessionId)?.participants.includes(userId) ?? false),
            readSession: async (sessionId) => {
                calls.readSession += 1;
                const session = world.sessions.get(sessionId);
                if (!session) {
                    return null;
                }
                const { status, archived, current_stage, design_type } = session;
                return { status, archived, current_stage, design_type };
            },
            findTask: async (lookup) => {
                calls.findTask.push(lookup);
                const phase = world.phases.get(lookup.phaseId);
                return phase?.tasks.includes(lookup.taskId)
                    ? { id: lookup.taskId, num_values: 5 }
                    : null;
            },
            warn: (message, entry) => calls.warnings.push({ message, entry }),
        },
    };
}

function evaluate(request, dependencies) {
    return evaluateStudentResponse({
        sessionId:  SESSION_ID,
        userId:     STUDENT,
        questionId: QUESTION,
        payload:    { phaseId: INDIVIDUAL_PHASE, questionId: QUESTION, value: 3 },
        ...request,
    }, dependencies);
}

describe("student response policy: refusals", () => {
    it("answers a student of another session as an unknown session, and logs it", async () => {
        const { calls, dependencies } = fakes();

        const decision = await evaluate({ sessionId: OTHER_SESSION_ID }, dependencies);

        assert.deepEqual(decision, {
            allowed: false,
            status:  404,
            code:    RESPONSE_REFUSAL_CODES.SESSION_NOT_FOUND,
            error:   "Session not found.",
        });
        assert.equal(calls.readSession, 0);
        assert.deepEqual(calls.warnings, [{
            message: "[security] Refused a student response.",
            entry:   {
                event:     STUDENT_RESPONSE_REFUSED_EVENT,
                userId:    STUDENT,
                sessionId: OTHER_SESSION_ID,
            },
        }]);
    });

    it("answers an anonymized student as an unknown session", async () => {
        const { calls, dependencies } = fakes();

        const decision = await evaluate({ userId: FORGOTTEN_STUDENT }, dependencies);

        assert.equal(decision.status, 404);
        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.SESSION_NOT_FOUND);
        assert.equal(decision.error, "Session not found.");
        assert.equal(calls.readSession, 0);
    });

    it("answers an unknown session with the same 404", async () => {
        const { dependencies } = fakes();

        const unknown = await evaluate({ sessionId: UNKNOWN_SESSION_ID }, dependencies);
        const foreign = await evaluate({ sessionId: OTHER_SESSION_ID }, dependencies);

        assert.deepEqual(unknown, foreign);
    });

    it("refuses a finished activity, which has no current phase", async () => {
        const { calls, dependencies } = fakes(activity({ status: FINISHED, current_stage: null }));

        const decision = await evaluate({}, dependencies);

        assert.equal(decision.status, 409);
        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.ACTIVITY_FINISHED);
        assert.deepEqual(calls.findTask, []);
    });

    it("refuses an archived activity", async () => {
        const { calls, dependencies } = fakes(activity({ archived: true }));

        const decision = await evaluate({}, dependencies);

        assert.equal(decision.status, 409);
        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.ACTIVITY_FINISHED);
        assert.deepEqual(calls.findTask, []);
    });

    it("refuses an activity with no active phase", async () => {
        const { dependencies } = fakes(activity({ status: 1, current_stage: null }));

        const decision = await evaluate({}, dependencies);

        assert.deepEqual(decision, {
            allowed: false,
            status:  409,
            code:    RESPONSE_REFUSAL_CODES.NO_ACTIVE_PHASE,
            error:   "Session has no active phase.",
        });
    });

    it("refuses a response to a phase that is no longer the current one", async () => {
        const { calls, dependencies } = fakes(activity({ current_stage: TEAM_PHASE }));

        const decision = await evaluate({}, dependencies);

        assert.equal(decision.status, 409);
        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.PHASE_CHANGED);
        assert.deepEqual(calls.findTask, []);
    });

    it("treats a phaseId that is not a phase id as a changed phase", async () => {
        const { dependencies } = fakes();

        const decision = await evaluate({ payload: { phaseId: "abc" } }, dependencies);

        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.PHASE_CHANGED);
    });

    it("refuses a design type that takes no responses", async () => {
        const { calls, dependencies } = fakes(activity({ design_type: null }));

        const decision = await evaluate({}, dependencies);

        assert.equal(decision.status, 400);
        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.UNSUPPORTED_DESIGN_TYPE);
        assert.deepEqual(calls.findTask, []);
    });

    it("refuses a question that is not in the current phase", async () => {
        const { dependencies } = fakes();

        const decision = await evaluate({
            questionId: TEAM_QUESTION,
            payload:    { phaseId: INDIVIDUAL_PHASE, questionId: TEAM_QUESTION },
        }, dependencies);

        assert.deepEqual(decision, {
            allowed: false,
            status:  400,
            code:    RESPONSE_REFUSAL_CODES.QUESTION_NOT_IN_PHASE,
            error:   "Question not found in the current phase.",
        });
    });

    it("refuses a ranking item that is not in the current phase, or not an id", async () => {
        const { calls, dependencies } = fakes(activity({ design_type: "ranking" }));

        const missing = await evaluate({ payload: { itemId: TEAM_QUESTION } }, dependencies);
        const invalid = await evaluate({ payload: { itemId: "x" } }, dependencies);

        for (const decision of [missing, invalid]) {
            assert.equal(decision.status, 400);
            assert.equal(decision.code, RESPONSE_REFUSAL_CODES.QUESTION_NOT_IN_PHASE);
            assert.equal(decision.error, "Ranking item not found in the current phase.");
        }
        assert.equal(calls.findTask.length, 1);
    });
});

describe("student response policy: enrolled students", () => {
    it("lets a student answer the current individual phase", async () => {
        const { calls, dependencies } = fakes();

        const decision = await evaluate({}, dependencies);

        assert.deepEqual(decision, {
            allowed:    true,
            phaseId:    INDIVIDUAL_PHASE,
            designType: "semantic_differential",
            taskId:     QUESTION,
            task:       { id: QUESTION, num_values: 5 },
        });
        assert.deepEqual(calls.findTask, [{
            designType: "semantic_differential",
            phaseId:    INDIVIDUAL_PHASE,
            taskId:     QUESTION,
        }]);
        assert.deepEqual(calls.warnings, []);
    });

    it("lets a student with a group answer a team phase", async () => {
        const { dependencies } = fakes(activity({ current_stage: TEAM_PHASE }));

        const decision = await evaluate({
            questionId: TEAM_QUESTION,
            payload:    { phaseId: TEAM_PHASE, questionId: TEAM_QUESTION },
        }, dependencies);

        assert.equal(decision.allowed, true);
        assert.equal(decision.phaseId, TEAM_PHASE);
    });

    it("lets a student without a group answer a team phase (#930)", async () => {
        const { dependencies } = fakes(activity({ current_stage: TEAM_PHASE }));

        const decision = await evaluate({
            userId:     GROUPLESS_STUDENT,
            questionId: TEAM_QUESTION,
            payload:    { phaseId: TEAM_PHASE, questionId: TEAM_QUESTION },
        }, dependencies);

        assert.equal(decision.allowed, true);
        assert.equal(decision.phaseId, TEAM_PHASE);
        assert.equal(decision.taskId, TEAM_QUESTION);
    });

    it("accepts a payload without phaseId, or with it as a string", async () => {
        const { dependencies } = fakes();

        const withoutPhase = await evaluate({ payload: { questionId: QUESTION } }, dependencies);
        const asString = await evaluate(
            { payload: { phaseId: String(INDIVIDUAL_PHASE) } },
            dependencies,
        );

        assert.equal(withoutPhase.allowed, true);
        assert.equal(asString.allowed, true);
    });

    it("finds a ranking item by itemId, or by questionId", async () => {
        const { calls, dependencies } = fakes(activity({ design_type: "ranking" }));

        const byItem = await evaluate({ payload: { itemId: RANKING_ITEM } }, dependencies);
        const byQuestion = await evaluate({ questionId: RANKING_ITEM, payload: {} }, dependencies);

        assert.equal(byItem.allowed, true);
        assert.equal(byItem.taskId, RANKING_ITEM);
        assert.equal(byQuestion.allowed, true);
        const designTypes = calls.findTask.map(({ designType }) => designType);
        assert.deepEqual(designTypes, ["ranking", "ranking"]);
    });
});

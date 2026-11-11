// The response submission policy (#927, epic #923): one test per refusal,
// and the students it must let through, a student without a group in a team
// phase among them; and the grace window for the previous phase after an
// automatic advance (#1114, epic #1105). The database reads are replaced by
// fakes over a small in-memory activity, so nothing here needs PostgreSQL;
// the integration suite runs the same rules against the real SQL
// (controllers/activities/__tests__/deadline-grace-window.integration-test.mjs).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DEADLINE_GRACE_WINDOW_SECONDS,
    RESPONSE_REFUSAL_CODES,
    STUDENT_RESPONSE_REFUSED_EVENT,
    evaluateStudentResponse,
    isWithinDeadlineGraceWindow,
    previousPhaseTakesAnswers,
} from "../student-response-policy.js";

const STUDENT = 9;
const GROUPLESS_STUDENT = 14;
const OUTSIDER = 11;
const FORGOTTEN_STUDENT = 13;

const SESSION_ID = 10;
const OTHER_SESSION_ID = 20;
const UNKNOWN_SESSION_ID = 999;

const EARLIER_PHASE = 98;
const PREVIOUS_PHASE = 99;
const INDIVIDUAL_PHASE = 100;
const TEAM_PHASE = 101;
const QUESTION = 1;
const TEAM_QUESTION = 2;
const PREVIOUS_QUESTION = 3;
const EARLIER_QUESTION = 4;
const PREVIOUS_RANKING_ITEM = 8;
const RANKING_ITEM = 7;

const IN_PROGRESS = 2;
const FINISHED = 3;

// The activity the fakes answer for. The team phase has a group for STUDENT
// only: GROUPLESS_STUDENT joined after the groups were formed. By default the
// teacher started the current phase a minute ago, after EARLIER_PHASE and
// PREVIOUS_PHASE.
function activity(overrides = {}) {
    return {
        sessions: new Map([
            [SESSION_ID, {
                status:                            IN_PROGRESS,
                archived:                          false,
                current_stage:                     INDIVIDUAL_PHASE,
                design_type:                       "semantic_differential",
                current_phase_start_trigger:       "teacher",
                current_phase_seconds_since_start: "60.000000",
                previous_phase_id:                 PREVIOUS_PHASE,
                participants:                      [STUDENT, GROUPLESS_STUDENT, FORGOTTEN_STUDENT],
                ...overrides,
            }],
            [OTHER_SESSION_ID, {
                status:                            IN_PROGRESS,
                archived:                          false,
                current_stage:                     200,
                design_type:                       "semantic_differential",
                current_phase_start_trigger:       "deadline",
                current_phase_seconds_since_start: "1.000000",
                previous_phase_id:                 199,
                participants:                      [OUTSIDER],
            }],
        ]),
        phases: new Map([
            [EARLIER_PHASE, { type: "individual", tasks: [EARLIER_QUESTION], groups: [] }],
            [PREVIOUS_PHASE, {
                type:   "individual",
                tasks:  [PREVIOUS_QUESTION, PREVIOUS_RANKING_ITEM],
                groups: [],
            }],
            [INDIVIDUAL_PHASE, { type: "individual", tasks: [QUESTION, RANKING_ITEM], groups: [] }],
            [TEAM_PHASE, { type: "team", tasks: [TEAM_QUESTION], groups: [[STUDENT]] }],
            [199, { type: "individual", tasks: [PREVIOUS_QUESTION], groups: [] }],
        ]),
        anonymized: new Set([FORGOTTEN_STUDENT]),
    };
}

// The current phase was started by the deadline runner `seconds` ago.
function afterDeadlineAdvance(seconds = "2.500000", overrides = {}) {
    return activity({
        current_phase_start_trigger:       "deadline",
        current_phase_seconds_since_start: seconds,
        ...overrides,
    });
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
                // A row of STUDENT_RESPONSE_SESSION_SQL: the session without
                // its participants.
                const row = { ...session };
                delete row.participants;
                return row;
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
            allowed:       true,
            phaseId:       INDIVIDUAL_PHASE,
            previousPhase: false,
            designType:    "semantic_differential",
            taskId:        QUESTION,
            task:          { id: QUESTION, num_values: 5 },
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

describe("student response policy: grace window after an automatic advance (#1114)", () => {
    const previousAnswer = (overrides = {}) => ({
        questionId: PREVIOUS_QUESTION,
        payload:    { phaseId: PREVIOUS_PHASE, questionId: PREVIOUS_QUESTION, value: 4 },
        ...overrides,
    });

    it("accepts an answer to the previous phase, and sends it to that phase", async () => {
        const { calls, dependencies } = fakes(afterDeadlineAdvance());

        const decision = await evaluate(previousAnswer(), dependencies);

        assert.deepEqual(decision, {
            allowed:       true,
            phaseId:       PREVIOUS_PHASE,
            previousPhase: true,
            designType:    "semantic_differential",
            taskId:        PREVIOUS_QUESTION,
            task:          { id: PREVIOUS_QUESTION, num_values: 5 },
        });
        assert.deepEqual(calls.findTask, [{
            designType: "semantic_differential",
            phaseId:    PREVIOUS_PHASE,
            taskId:     PREVIOUS_QUESTION,
        }]);
    });

    it("accepts the previous phase's id as a string, and a ranking item of it", async () => {
        const { dependencies } = fakes(afterDeadlineAdvance("0.2", { design_type: "ranking" }));

        const decision = await evaluate({
            questionId: PREVIOUS_RANKING_ITEM,
            payload:    {
                phaseId: String(PREVIOUS_PHASE),
                itemId:  PREVIOUS_RANKING_ITEM,
                order:   1,
            },
        }, dependencies);

        assert.equal(decision.allowed, true);
        assert.equal(decision.phaseId, PREVIOUS_PHASE);
        assert.equal(decision.previousPhase, true);
        assert.equal(decision.taskId, PREVIOUS_RANKING_ITEM);
    });

    it("keeps accepting the current phase in the window, as a current answer", async () => {
        const { dependencies } = fakes(afterDeadlineAdvance());

        const withPhase = await evaluate({}, dependencies);
        const withoutPhase = await evaluate({ payload: { questionId: QUESTION } }, dependencies);

        for (const decision of [withPhase, withoutPhase]) {
            assert.equal(decision.allowed, true);
            assert.equal(decision.phaseId, INDIVIDUAL_PHASE);
            assert.equal(decision.previousPhase, false);
        }
    });

    it("refuses the previous phase once the window has passed", async () => {
        for (const seconds of [String(DEADLINE_GRACE_WINDOW_SECONDS), "15.000001", "3600"]) {
            const { calls, dependencies } = fakes(afterDeadlineAdvance(seconds));

            const decision = await evaluate(previousAnswer(), dependencies);

            assert.equal(decision.status, 409, `after ${seconds} s`);
            assert.equal(decision.code, RESPONSE_REFUSAL_CODES.PHASE_CHANGED);
            assert.deepEqual(calls.findTask, []);
        }
    });

    it("refuses the previous phase after a teacher's advance, however recent", async () => {
        const { calls, dependencies } = fakes(activity({
            current_phase_start_trigger:       "teacher",
            current_phase_seconds_since_start: "0.5",
        }));

        const decision = await evaluate(previousAnswer(), dependencies);

        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.PHASE_CHANGED);
        assert.deepEqual(calls.findTask, []);
    });

    it("refuses an older phase in the window", async () => {
        const { calls, dependencies } = fakes(afterDeadlineAdvance());

        const decision = await evaluate({
            questionId: EARLIER_QUESTION,
            payload:    { phaseId: EARLIER_PHASE, questionId: EARLIER_QUESTION, value: 2 },
        }, dependencies);

        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.PHASE_CHANGED);
        assert.deepEqual(calls.findTask, []);
    });

    it("refuses a phase of another session, even the previous phase there", async () => {
        const { calls, dependencies } = fakes(afterDeadlineAdvance());

        const decision = await evaluate(previousAnswer({
            payload: { phaseId: 199, questionId: PREVIOUS_QUESTION, value: 4 },
        }), dependencies);

        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.PHASE_CHANGED);
        assert.deepEqual(calls.findTask, []);
    });

    it("refuses any other phase while the first phase is current", async () => {
        // The first phase has no previous one; the deadline runner never
        // starts it, but the rule holds whatever its trigger.
        const { dependencies } = fakes(afterDeadlineAdvance("1", { previous_phase_id: null }));

        const decision = await evaluate(previousAnswer(), dependencies);

        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.PHASE_CHANGED);
    });

    it("refuses the previous phase when the current one has no recorded start", async () => {
        // A phase started before V45 has neither started_at nor start_trigger.
        const { dependencies } = fakes(activity({
            current_phase_start_trigger:       null,
            current_phase_seconds_since_start: null,
        }));

        const decision = await evaluate(previousAnswer(), dependencies);

        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.PHASE_CHANGED);
    });

    it("refuses a question that is not in the previous phase", async () => {
        const { calls, dependencies } = fakes(afterDeadlineAdvance());

        const decision = await evaluate({
            questionId: QUESTION,
            payload:    { phaseId: PREVIOUS_PHASE, questionId: QUESTION, value: 3 },
        }, dependencies);

        assert.equal(decision.status, 400);
        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.QUESTION_NOT_IN_PHASE);
        assert.deepEqual(calls.findTask.map(({ phaseId }) => phaseId), [PREVIOUS_PHASE]);
    });

    it("refuses a student of another session before reading anything", async () => {
        const { calls, dependencies } = fakes(afterDeadlineAdvance());

        const decision = await evaluate(previousAnswer({ userId: OUTSIDER }), dependencies);

        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.SESSION_NOT_FOUND);
        assert.equal(calls.readSession, 0);
    });

    it("refuses a finished activity in the window", async () => {
        const { dependencies } = fakes(afterDeadlineAdvance("1", {
            status:        FINISHED,
            current_stage: null,
        }));

        const decision = await evaluate(previousAnswer(), dependencies);

        assert.equal(decision.code, RESPONSE_REFUSAL_CODES.ACTIVITY_FINISHED);
    });
});

describe("isWithinDeadlineGraceWindow", () => {
    it("is open for less than the window after a deadline start", () => {
        assert.equal(DEADLINE_GRACE_WINDOW_SECONDS, 15);
        for (const secondsSinceStart of [0, "0.000000", 14.999, "14.999999"]) {
            assert.equal(isWithinDeadlineGraceWindow({
                startTrigger: "deadline",
                secondsSinceStart,
            }), true, String(secondsSinceStart));
        }
    });

    it("is closed from the window's end, and without a deadline start", () => {
        const closed = [
            { startTrigger: "deadline", secondsSinceStart: 15 },
            { startTrigger: "deadline", secondsSinceStart: "15.000000" },
            { startTrigger: "deadline", secondsSinceStart: null },
            { startTrigger: "deadline", secondsSinceStart: undefined },
            { startTrigger: "deadline", secondsSinceStart: "not a number" },
            { startTrigger: "teacher", secondsSinceStart: 1 },
            { startTrigger: null, secondsSinceStart: 1 },
        ];
        for (const phase of closed) {
            assert.equal(isWithinDeadlineGraceWindow(phase), false, JSON.stringify(phase));
        }
    });
});

describe("previousPhaseTakesAnswers", () => {
    it("reads the phase's start and applies the window", async () => {
        const starts = new Map([
            [1, { start_trigger: "deadline", seconds_since_start: "3.2" }],
            [2, { start_trigger: "deadline", seconds_since_start: "20" }],
            [3, { start_trigger: "teacher", seconds_since_start: "3.2" }],
        ]);
        const readPhaseStart = async phaseId => starts.get(phaseId) ?? null;

        const answers = await Promise.all([1, 2, 3, 4].map(phaseId =>
            previousPhaseTakesAnswers(phaseId, { readPhaseStart })));

        assert.deepEqual(answers, [true, false, false, false]);
    });
});

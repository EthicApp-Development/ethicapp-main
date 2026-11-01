// POST /activities/:id/response (#927, epic #923): role A first, then the
// response policy, before anything is written. A refusal writes no response,
// notifies no teacher and dispatches no AI-service hook. The policy's own
// reasons are covered in helpers/__tests__/student-response-policy.node-test.mjs;
// this runs the real policy against a fake pg pool that answers by matching
// the SQL, so nothing here needs a database or Redis.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from "node:test";

import activitiesStudentRouter, { responseSubmissionEffects } from "../activities-student.js";
import redisClient from "../../../db/redis.js";
import { SESSION_ACCESS_SQL } from "../../../helpers/activity-owner-helper.js";
import {
    RANKING_TASK_SQL,
    SEMANTIC_DIFFERENTIAL_TASK_SQL,
    STUDENT_RESPONSE_SESSION_SQL,
} from "../../../helpers/student-response-policy.js";
import { installFakePgPool, requestRouter } from "../../__tests__/fake-pg-pool.mjs";

const TEACHER = Object.freeze({ uid: 5, role: "P" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });
const GROUPLESS_STUDENT = Object.freeze({ uid: 14, role: "A" });
const OUTSIDER = Object.freeze({ uid: 11, role: "A" });
const FORGOTTEN_STUDENT = Object.freeze({ uid: 13, role: "A" });

const SESSION_ID = 10;
const OTHER_SESSION_ID = 20;
const UNKNOWN_SESSION_ID = 999;
const INDIVIDUAL_PHASE = 100;
const TEAM_PHASE = 101;
const QUESTION = 1;
const TEAM_QUESTION = 2;
const RANKING_ITEM = 7;

// --- Fake PostgreSQL -------------------------------------------------------

// The team phase has a group for STUDENT only: GROUPLESS_STUDENT joined after
// the groups were formed. The route never reads groups.
let sessions;
const phases = new Map([
    [INDIVIDUAL_PHASE, { questions: [QUESTION], items: [RANKING_ITEM] }],
    [TEAM_PHASE, { questions: [TEAM_QUESTION], items: [] }],
]);
const anonymizedUserIds = new Set([FORGOTTEN_STUDENT.uid]);

function resetSessions(overrides = {}) {
    sessions = new Map([
        [SESSION_ID, {
            creator:       TEACHER.uid,
            participants:  [TEACHER.uid, STUDENT.uid, GROUPLESS_STUDENT.uid, FORGOTTEN_STUDENT.uid],
            status:        2,
            archived:      false,
            current_stage: INDIVIDUAL_PHASE,
            design_type:   "semantic_differential",
            ...overrides,
        }],
        [OTHER_SESSION_ID, {
            creator:       6,
            participants:  [6, OUTSIDER.uid],
            status:        2,
            archived:      false,
            current_stage: 200,
            design_type:   "semantic_differential",
        }],
    ]);
}

function rowsFor(sql, params = []) {
    const [first, second] = params.map(Number);

    if (sql === SESSION_ACCESS_SQL) {
        const session = sessions.get(first);
        if (!session) {
            return [];
        }
        const requester = anonymizedUserIds.has(second) ? null : second;
        return [{
            session_id:  first,
            owned:       session.creator === requester,
            participant: session.participants.includes(requester),
        }];
    }
    if (sql === STUDENT_RESPONSE_SESSION_SQL) {
        const session = sessions.get(first);
        if (!session) {
            return [];
        }
        const { status, archived, current_stage, design_type } = session;
        return [{ status, archived, current_stage, design_type }];
    }
    if (sql === SEMANTIC_DIFFERENTIAL_TASK_SQL) {
        return phases.get(first)?.questions.includes(second)
            ? [{ id: second, num_values: 5, requires_justification: false, min_word_count: 0 }]
            : [];
    }
    if (sql === RANKING_TASK_SQL) {
        return phases.get(first)?.items.includes(second)
            ? [{ id: second, requires_justification: false, min_word_count: 0 }]
            : [];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => {
    db.restore();
    // The controller imports the Redis-backed state caches, whose client
    // starts connecting on import. No test here reaches Redis.
    redisClient.disconnect();
});

let notifyTeacher;
let dispatchHook;

beforeEach(() => {
    db.reset();
    resetSessions();
    notifyTeacher = mock.method(responseSubmissionEffects, "notifyTeacher", () => {});
    dispatchHook = mock.method(responseSubmissionEffects, "dispatchHook", async () => {});
});

afterEach(() => {
    mock.restoreAll();
});

function responseWrites() {
    const responseTables = /INSERT INTO (differential_selection|actor_selection)/u;
    return db.queries.filter(({ sql }) => responseTables.test(sql));
}

function submit(session, {
    sessionId = SESSION_ID,
    body = { phaseId: INDIVIDUAL_PHASE, questionId: QUESTION, value: 3, justification: "Because." },
} = {}) {
    return requestRouter(activitiesStudentRouter, {
        method: "POST",
        path:   `/activities/${sessionId}/response`,
        body,
        session,
    });
}

function assertNothingSetOff() {
    assert.deepEqual(responseWrites(), []);
    assert.equal(notifyTeacher.mock.callCount(), 0);
    assert.equal(dispatchHook.mock.callCount(), 0);
}

// --- Accepted responses ----------------------------------------------------

describe("POST /activities/:id/response: enrolled students", () => {
    it("stores the response, notifies the teacher and dispatches the hook", async () => {
        const { status, body } = await submit(STUDENT);

        assert.equal(status, 201);
        assert.deepEqual(body, { status: "ok", message: "Response submitted successfully." });

        const [write] = responseWrites();
        assert.match(write.sql, /INSERT INTO differential_selection/u);
        assert.deepEqual(write.params.slice(0, 4), [3, "Because.", QUESTION, STUDENT.uid]);

        const expectedResponse = {
            type:    "semantic_differential",
            uid:     STUDENT.uid,
            did:     QUESTION,
            sel:     3,
            comment: "Because.",
        };
        assert.deepEqual(notifyTeacher.mock.calls[0].arguments,
            [SESSION_ID, INDIVIDUAL_PHASE, expectedResponse]);
        assert.equal(dispatchHook.mock.callCount(), 1);
        const [context] = dispatchHook.mock.calls[0].arguments;
        assert.equal(context.sessionId, SESSION_ID);
        assert.equal(context.phaseId, INDIVIDUAL_PHASE);
        assert.equal(context.userId, STUDENT.uid);
        assert.equal(context.designType, "semantic_differential");
        assert.deepEqual(context.responsePayload, expectedResponse);
    });

    for (const student of [STUDENT, GROUPLESS_STUDENT]) {
        const who = student === STUDENT ? "with a group" : "without a group (#930)";
        it(`accepts a team phase response from a student ${who}`, async () => {
            resetSessions({ current_stage: TEAM_PHASE });

            const { status } = await submit(student, {
                body: { phaseId: TEAM_PHASE, questionId: TEAM_QUESTION, value: 2 },
            });

            assert.equal(status, 201);
            assert.equal(responseWrites().length, 1);
            const [notifiedSession, notifiedPhase] = notifyTeacher.mock.calls[0].arguments;
            assert.deepEqual([notifiedSession, notifiedPhase], [SESSION_ID, TEAM_PHASE]);
            assert.equal(dispatchHook.mock.callCount(), 1);
            assert.ok(db.queries.every(({ sql }) => !/\bteam(s|users)\b/u.test(sql)),
                "groups are not consulted");
        });
    }

    it("stores a ranking response for an item of the current phase", async () => {
        resetSessions({ design_type: "ranking" });

        const { status } = await submit(STUDENT, {
            body: {
                phaseId:    INDIVIDUAL_PHASE,
                questionId: RANKING_ITEM,
                itemId:     RANKING_ITEM,
                order:      1,
            },
        });

        assert.equal(status, 201);
        const [write] = responseWrites();
        assert.match(write.sql, /INSERT INTO actor_selection/u);
        assert.deepEqual(write.params.slice(0, 5),
            [1, null, RANKING_ITEM, STUDENT.uid, INDIVIDUAL_PHASE]);
        assert.equal(notifyTeacher.mock.callCount(), 1);
        assert.equal(dispatchHook.mock.callCount(), 1);
    });
});

// --- Refusals --------------------------------------------------------------

describe("POST /activities/:id/response: refusals", () => {
    it("refuses a teacher with 403 before any query", async () => {
        const { status } = await submit(TEACHER);

        assert.equal(status, 403);
        assert.equal(db.queries.length, 0);
        assertNothingSetOff();
    });

    const SESSION_NOT_FOUND = { error: "Session not found.", code: "SESSION_NOT_FOUND" };

    it("answers a student of another session as an unknown session", async () => {
        const warn = mock.method(console, "warn", () => {});

        const { status, body } = await submit(OUTSIDER);

        assert.equal(status, 404);
        assert.deepEqual(body, SESSION_NOT_FOUND);
        assert.equal(warn.mock.callCount(), 1);
        assert.ok(db.queries.every(({ sql }) => sql === SESSION_ACCESS_SQL),
            "nothing about the session is read");
        assertNothingSetOff();
    });

    it("answers an anonymized student as an unknown session", async () => {
        mock.method(console, "warn", () => {});

        const { status, body } = await submit(FORGOTTEN_STUDENT);

        assert.equal(status, 404);
        assert.deepEqual(body, SESSION_NOT_FOUND);
        assertNothingSetOff();
    });

    it("answers an unknown session with the same body", async () => {
        mock.method(console, "warn", () => {});

        const { status, body } = await submit(STUDENT, { sessionId: UNKNOWN_SESSION_ID });

        assert.equal(status, 404);
        assert.deepEqual(body, SESSION_NOT_FOUND);
        assertNothingSetOff();
    });

    const conflicts = [
        ["a finished activity", { status: 3, current_stage: null }, "ACTIVITY_FINISHED"],
        ["an archived activity", { archived: true }, "ACTIVITY_FINISHED"],
        ["an activity with no active phase", { status: 1, current_stage: null }, "NO_ACTIVE_PHASE"],
        ["a phase that changed since the student loaded it", { current_stage: TEAM_PHASE },
            "PHASE_CHANGED"],
    ];
    for (const [what, overrides, code] of conflicts) {
        it(`refuses ${what} with 409 ${code}`, async () => {
            resetSessions(overrides);

            const { status, body } = await submit(STUDENT);

            assert.equal(status, 409);
            assert.equal(body.code, code);
            assert.equal(typeof body.error, "string");
            assertNothingSetOff();
        });
    }

    it("refuses a question outside the current phase with 400 QUESTION_NOT_IN_PHASE", async () => {
        const { status, body } = await submit(STUDENT, {
            body: { phaseId: INDIVIDUAL_PHASE, questionId: TEAM_QUESTION, value: 3 },
        });

        assert.equal(status, 400);
        assert.deepEqual(body, {
            error: "Question not found in the current phase.",
            code:  "QUESTION_NOT_IN_PHASE",
        });
        assertNothingSetOff();
    });

    it("keeps refusing an invalid value after the policy, with nothing set off", async () => {
        const { status, body } = await submit(STUDENT, {
            body: { phaseId: INDIVIDUAL_PHASE, questionId: QUESTION, value: 9 },
        });

        assert.equal(status, 400);
        assert.deepEqual(body, { error: "Invalid value. It must be an integer between 1 and 5." });
        assertNothingSetOff();
    });
});

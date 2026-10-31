// POST /activities/:session_id/phases/next (#906): only the activity's owner
// starts its next phase, a teacher who created the session and whose account
// is not anonymized (#905), and the request carries nothing but the phase
// number the teacher sees. The endpoints with which the dashboard used to
// build a phase are gone. PostgreSQL is replaced by a fake pg pool that
// answers by matching the SQL, so nothing here needs a database or Redis.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import activitiesTeacherRouter from "../activities/activities-teacher.js";
import { createPhaseStartRouter } from "../activities/phase-start.js";
import phasesRouter from "../phases.js";
import groupsRouter from "../groups.js";
import redisClient from "../../db/redis.js";
import { SESSION_OWNERSHIP_SQL } from "../../helpers/activity-owner-helper.js";
import {
    ACTIVITY_DESIGN_SQL,
    INSERT_PHASE_SQL,
    LOCK_SESSION_SQL,
    LOCK_TEACHER_SQL,
    createPhaseStarter,
} from "../../helpers/phase-start-helper.js";
import { INSERT_DIFFERENTIAL_ITEMS_SQL } from "../../helpers/phase-items-helper.js";
import { TRANSITION_SESSION_SQL } from "../../helpers/teacher-activity-writes.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER = Object.freeze({ uid: 5, role: "P" });
const OTHER_TEACHER = Object.freeze({ uid: 6, role: "P" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });
const FORGOTTEN_OWNER = Object.freeze({ uid: 8, role: "P" });

const SESSION_ID = 10;
const OTHER_SESSION_ID = 20;
const FORGOTTEN_SESSION_ID = 30;
const PHASE_ID = 100;
const UNKNOWN_ID = 999;

const DENIED = { error: "Access denied. User is not authorized for this activity." };

// --- Fake PostgreSQL -------------------------------------------------------

const sessions = new Map([
    [SESSION_ID, { creator: OWNER.uid }],
    [OTHER_SESSION_ID, { creator: OTHER_TEACHER.uid }],
    [FORGOTTEN_SESSION_ID, { creator: FORGOTTEN_OWNER.uid }],
]);
const anonymizedUserIds = new Set([FORGOTTEN_OWNER.uid]);

const DESIGN = {
    type:   "semantic_differential",
    phases: [{
        mode:      "individual",
        anonymous: true,
        questions: [{ q_text: "Q", ans_format: { l_pole: "L", r_pole: "R", values: 7 } }],
    }],
};

function rowsFor(sql, params = []) {
    if (sql === SESSION_OWNERSHIP_SQL) {
        const session = sessions.get(Number(params[0]));
        if (!session) {
            return [];
        }
        const requester = Number(params[1]);
        return [{
            session_id: Number(params[0]),
            owned:      session.creator === requester && !anonymizedUserIds.has(requester),
        }];
    }
    if (sql === LOCK_TEACHER_SQL) {
        return [{ id: params[0] }];
    }
    if (sql === LOCK_SESSION_SQL) {
        return [{ id: params[0], creator: OWNER.uid, status: 1, current_stage: null }];
    }
    if (sql === ACTIVITY_DESIGN_SQL) {
        return [{ design: DESIGN }];
    }
    if (sql === INSERT_PHASE_SQL) {
        return [{ id: PHASE_ID }];
    }
    if (sql === TRANSITION_SESSION_SQL) {
        return [{ id: params[2] }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => {
    db.restore();
    // The groups controller imports a Redis-backed cache, whose client starts
    // connecting on import. No test here reaches Redis.
    redisClient.disconnect();
});

// A starter that records its calls and answers with `result`.
function fakeStarter(result = { status: "started", phase: { id: PHASE_ID, number: 1 } }) {
    const calls = [];
    return {
        calls,
        startNextPhase: async (request) => {
            calls.push(request);
            if (result instanceof Error) {
                throw result;
            }
            return result;
        },
    };
}

let starter = fakeStarter();

beforeEach(() => {
    db.reset();
    starter = fakeStarter();
});

function startNext(session, { sessionId = SESSION_ID, body = { expectedPhaseNumber: 0 } } = {}) {
    return requestRouter(createPhaseStartRouter({ phaseStarter: starter }), {
        method: "POST",
        path:   `/activities/${sessionId}/phases/next`,
        body,
        session,
    });
}

// --- Authorization ---------------------------------------------------------

describe("POST /activities/:session_id/phases/next: who may start a phase", () => {
    it("refuses a student without querying anything", async () => {
        const { status } = await startNext(STUDENT);

        assert.equal(status, 403);
        assert.equal(db.queries.length, 0);
        assert.deepEqual(starter.calls, []);
    });

    it("refuses a teacher who does not own the activity", async () => {
        const { status, body } = await startNext(OTHER_TEACHER);

        assert.equal(status, 403);
        assert.deepEqual(body, DENIED);
        assert.deepEqual(starter.calls, []);
    });

    it("refuses the owner once the account is anonymized", async () => {
        const { status, body } = await startNext(FORGOTTEN_OWNER,
            { sessionId: FORGOTTEN_SESSION_ID });

        assert.equal(status, 403);
        assert.deepEqual(body, DENIED);
        assert.deepEqual(starter.calls, []);
    });

    it("refuses the owner's request on another teacher's activity", async () => {
        const { status, body } = await startNext(OWNER, { sessionId: OTHER_SESSION_ID });

        assert.equal(status, 403);
        assert.deepEqual(body, DENIED);
        assert.deepEqual(starter.calls, []);
    });

    it("answers 404 for an unknown session", async () => {
        const { status, body } = await startNext(OWNER, { sessionId: UNKNOWN_ID });

        assert.equal(status, 404);
        assert.deepEqual(body, { error: "Session not found." });
        assert.deepEqual(starter.calls, []);
    });

    it("answers 404 for a session id that is not a positive integer, unqueried", async () => {
        const { status } = await startNext(OWNER, { sessionId: "abc" });

        assert.equal(status, 404);
        assert.equal(db.queries.length, 0);
        assert.deepEqual(starter.calls, []);
    });
});

// --- Request ---------------------------------------------------------------

describe("POST /activities/:session_id/phases/next: the request", () => {
    for (const body of [{}, { expectedPhaseNumber: -1 }, { expectedPhaseNumber: 1.5 },
        { expectedPhaseNumber: "1" }, { expectedPhaseNumber: null }]) {
        it(`rejects ${JSON.stringify(body)} without querying`, async () => {
            const { status, body: response } = await startNext(OWNER, { body });

            assert.equal(status, 400);
            assert.deepEqual(response,
                { error: "expectedPhaseNumber must be a non-negative integer." });
            assert.equal(db.queries.length, 0);
            assert.deepEqual(starter.calls, []);
        });
    }

    it("passes on the session, the teacher and the number, and ignores settings", async () => {
        const { status, body } = await startNext(OWNER, {
            body: {
                expectedPhaseNumber: 2,
                number:              7,
                type:                "team",
                anon:                false,
                chat:                true,
                grouping:            "9:random",
                prev_ans:            [1],
                question:            "Injected",
                sesid:               OTHER_SESSION_ID,
                userId:              OTHER_TEACHER.uid,
            },
        });

        assert.equal(status, 201);
        assert.deepEqual(body, { status: "ok", phase: { id: PHASE_ID, number: 1 } });
        assert.deepEqual(starter.calls,
            [{ sessionId: SESSION_ID, teacherId: OWNER.uid, expectedPhaseNumber: 2 }]);
    });
});

// --- Outcomes --------------------------------------------------------------

describe("POST /activities/:session_id/phases/next: outcomes", () => {
    const cases = [
        [{ status: "forbidden" }, 403, DENIED],
        [{ status: "not_found" }, 404, { error: "Session not found." }],
        [{ status: "not_launched" }, 404,
            { error: "The session has no activity.", code: "ACTIVITY_NOT_FOUND" }],
        [{ status: "finished" }, 409,
            { error: "The activity is finished.", code: "ACTIVITY_FINISHED" }],
        [{ status: "stale", currentPhaseNumber: 3 }, 409, {
            error:              "The activity is no longer at the expected phase.",
            code:               "PHASE_CHANGED",
            currentPhaseNumber: 3,
        }],
        [{ status: "no_next_phase", currentPhaseNumber: 3 }, 409, {
            error:              "The design has no phase after the current one.",
            code:               "NO_NEXT_PHASE",
            currentPhaseNumber: 3,
        }],
        [{ status: "invalid_design", problem: "Unsupported grouping algorithm: x" }, 422, {
            error: "Unsupported grouping algorithm: x",
            code:  "INVALID_PHASE_DESIGN",
        }],
    ];

    for (const [result, expectedStatus, expectedBody] of cases) {
        it(`answers ${expectedStatus} when the start is ${result.status}`, async () => {
            starter = fakeStarter(result);
            const { status, body } = await startNext(OWNER);

            assert.equal(status, expectedStatus);
            assert.deepEqual(body, expectedBody);
        });
    }

    it("answers 500 when the transaction fails", async () => {
        starter = fakeStarter(new Error("connection lost"));
        const { status, body } = await startNext(OWNER);

        assert.equal(status, 500);
        assert.deepEqual(body, { error: "Internal server error" });
    });

    it("runs the transaction for the owner, through the real starter", async () => {
        const effects = [];
        starter = createPhaseStarter({
            invalidateStudentDescriptor: async sessionId => effects.push(["invalidate", sessionId]),
            notifyStudents:              sessionId => effects.push(["notify", sessionId]),
            dispatchPhaseHook:           async hookName => effects.push([hookName]),
            logger:                      { warn() {}, error() {} },
        });

        const { status, body } = await startNext(OWNER);

        assert.equal(status, 201);
        assert.deepEqual(body, { status: "ok", phase: { id: PHASE_ID, number: 1 } });
        const statements = db.queries.map(({ sql }) => sql);
        const begin = statements.indexOf("BEGIN");
        assert.ok(begin > statements.indexOf(SESSION_OWNERSHIP_SQL),
            "the ownership check runs first");
        assert.deepEqual(statements.slice(begin, begin + 3),
            ["BEGIN", LOCK_TEACHER_SQL, LOCK_SESSION_SQL]);
        assert.ok(statements.includes(INSERT_DIFFERENTIAL_ITEMS_SQL));
        assert.deepEqual(statements.slice(-2), [TRANSITION_SESSION_SQL, "COMMIT"]);
        assert.deepEqual(effects.slice(0, 2), [["invalidate", SESSION_ID], ["notify", SESSION_ID]]);
    });
});

// --- Removed endpoints -----------------------------------------------------

describe("the endpoints with which the dashboard built a phase", () => {
    const routers = () => [
        activitiesTeacherRouter,
        createPhaseStartRouter({ phaseStarter: starter }),
        phasesRouter,
        groupsRouter,
    ];

    for (const path of [
        `/activities/${SESSION_ID}/phases`,
        `/phases/${PHASE_ID}/items`,
        `/phases/${PHASE_ID}/groups`,
        `/activities/${SESSION_ID}/phase_transition`,
    ]) {
        it(`POST ${path.replace(/\d+/gu, ":id")} answers 404 and writes nothing`, async () => {
            const { status } = await requestRouter(routers(), {
                method:  "POST",
                path,
                body:    { phaseId: PHASE_ID, number: 1, type: "individual" },
                session: OWNER,
            });

            assert.equal(status, 404);
            assert.equal(db.queries.length, 0);
            assert.deepEqual(starter.calls, []);
        });
    }
});

// The student state endpoints answer only to a student enrolled in the
// session, and `invalidate=true` flushes that session's caches only for them
// (#926). Anyone else is refused before any cache read or flush: a wrong role
// with 403, everything else with the 404 of an unknown session (#923).
// PostgreSQL is replaced by a fake pg pool that answers by matching the SQL,
// and the Redis cache client's get, set and del by an in-memory map, so
// nothing here needs a database or Redis.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import activitiesStudentRouter from "../activities/activities-student.js";
import redisClient from "../../db/redis.js";
import { SESSION_ACCESS_SQL } from "../../helpers/activity-owner-helper.js";
import { STUDENT_ACTIVITY_DESCRIPTOR_SQL } from "../../helpers/student-activity-descriptor.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER = Object.freeze({ uid: 5, role: "P" });
const SUPER_ADMIN = Object.freeze({ uid: 3, role: "S" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });
const PEER = Object.freeze({ uid: 12, role: "A" });
const OUTSIDER = Object.freeze({ uid: 11, role: "A" });
const FORGOTTEN_STUDENT = Object.freeze({ uid: 13, role: "A" });

const SESSION_ID = 10;
const OTHER_SESSION_ID = 20;
const PHASE_ID = 100;
const DESIGN_ID = 1;
const UNKNOWN_ID = 999;

const SESSION_NOT_FOUND = Object.freeze({ error: "Session not found." });

// --- Fake PostgreSQL -------------------------------------------------------

// A session's teacher is enrolled in it too (POST /sessions).
const sessions = new Map([
    [SESSION_ID, {
        creator:      OWNER.uid,
        participants: [OWNER.uid, STUDENT.uid, PEER.uid, FORGOTTEN_STUDENT.uid],
    }],
    [OTHER_SESSION_ID, {
        creator:      99,
        participants: [99, OUTSIDER.uid],
    }],
]);
const anonymizedUserIds = new Set([FORGOTTEN_STUDENT.uid]);

const SD_DESIGN = Object.freeze({
    type:   "semantic_differential",
    phases: [{ question: "Rate the case.", chat: false, anonymous: false }],
});

function sessionAccessRow(sessionId, requesterId) {
    const session = sessions.get(sessionId);
    if (!session) {
        return [];
    }
    const requester = anonymizedUserIds.has(requesterId) ? null : requesterId;
    return [{
        session_id:  sessionId,
        owned:       session.creator === requester,
        participant: session.participants.includes(requester),
    }];
}

// What the endpoints read once the check lets them through, for the one phase
// of SESSION_ID. Anything else (tasks, responses, groups, messages, the AI
// service policy) is answered with no rows.
function rowsFor(sql, params = []) {
    const [first, second] = params.map(Number);

    if (sql === SESSION_ACCESS_SQL) {
        return sessionAccessRow(first, second);
    }
    if (sql === STUDENT_ACTIVITY_DESCRIPTOR_SQL) {
        return sessions.has(first)
            ? [{
                description:        "Activity",
                design:             SD_DESIGN,
                currentphasenumber: 1,
                currentphaseid:     PHASE_ID,
            }]
            : [];
    }
    if (/SELECT d\.design\s+FROM activity a/u.test(sql)) {
        return [{ design: SD_DESIGN }];
    }
    if (/FROM\s+stages st\s+WHERE\s+st\.sesid = \$1/u.test(sql)) {
        return [{
            id:           PHASE_ID,
            number:       1,
            mode:         "individual",
            anon:         false,
            chat:         false,
            instructions: "Rate the case.",
        }];
    }
    if (/st\.sesid AS session_id,\s+d\.design AS design_json/u.test(sql)) {
        return [{ session_id: SESSION_ID, design_json: SD_DESIGN }];
    }
    if (/SELECT sesid, number\s+FROM stages/u.test(sql)) {
        return [{ sesid: SESSION_ID, number: 1 }];
    }
    if (/SELECT sesid\s+FROM stages/u.test(sql)) {
        return [{ sesid: SESSION_ID }];
    }
    if (/SELECT number\s+FROM stages/u.test(sql)) {
        return [{ number: 1 }];
    }
    if (/SELECT design\s+FROM activity\s+WHERE session = \$1/u.test(sql)) {
        return [{ design: DESIGN_ID }];
    }
    if (/SELECT design\s+FROM designs\s+WHERE id = \$1/u.test(sql)
        || /AS public\s+FROM designs/u.test(sql)) {
        return [{ id: DESIGN_ID, design: SD_DESIGN }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

// --- Fake Redis cache ------------------------------------------------------

// The cache helpers call get, set and del on the shared client. Own properties
// shadow the client's methods, so it never needs a server.
const cache = new Map();
const cacheCalls = [];

redisClient.get = async (key) => {
    cacheCalls.push({ op: "get", key });
    return cache.get(key) ?? null;
};
redisClient.set = async (key, value) => {
    cacheCalls.push({ op: "set", key });
    cache.set(key, value);
    return "OK";
};
redisClient.del = async (key) => {
    cacheCalls.push({ op: "del", key });
    return cache.delete(key) ? 1 : 0;
};

after(() => {
    db.restore();
    delete redisClient.get;
    delete redisClient.set;
    delete redisClient.del;
    // The client starts connecting on import; no test here reaches Redis.
    redisClient.disconnect();
});

beforeEach(() => {
    db.reset();
    cache.clear();
    cacheCalls.length = 0;
});

function flushedKeys() {
    return cacheCalls.filter(({ op }) => op === "del").map(({ key }) => key).sort();
}

// --- Requests --------------------------------------------------------------

function currentPhaseState(session, { sessionId = SESSION_ID, invalidate = false } = {}) {
    const query = invalidate ? "?invalidate=true" : "";
    return requestRouter(activitiesStudentRouter, {
        path: `/activities/${sessionId}/current_phase_state${query}`,
        session,
    });
}

function fullState(session, {
    sessionId = SESSION_ID,
    userId = session.uid,
    invalidate = false,
} = {}) {
    const query = invalidate ? "?invalidate=true" : "";
    return requestRouter(activitiesStudentRouter, {
        path: `/activities/${sessionId}/users/${userId}/full_state${query}`,
        session,
    });
}

// --- Shared expectations ---------------------------------------------------

/**
 * The refusals both endpoints share. `send(session, options)` sends the
 * request; `options` takes `sessionId` and `invalidate`. Every refusal comes
 * before any cache read or flush, even with `invalidate=true`.
 */
function refusalCases(send) {
    const wrongRoles = [["the session's teacher", OWNER], ["a super-admin", SUPER_ADMIN]];
    for (const [label, session] of wrongRoles) {
        it(`refuses ${label} with 403 without querying or touching the cache`, async () => {
            const { status } = await send(session, { invalidate: true });

            assert.equal(status, 403);
            assert.equal(db.queries.length, 0);
            assert.deepEqual(cacheCalls, []);
        });
    }

    it("answers a student enrolled elsewhere as an unknown session, flushing nothing", async () => {
        const { status, body } = await send(OUTSIDER, { invalidate: true });

        assert.equal(status, 404);
        assert.deepEqual(body, SESSION_NOT_FOUND);
        assert.deepEqual(db.queries.map(({ sql }) => sql), [SESSION_ACCESS_SQL]);
        assert.deepEqual(cacheCalls, []);
    });

    it("answers an anonymized student as an unknown session, flushing nothing", async () => {
        const { status, body } = await send(FORGOTTEN_STUDENT, { invalidate: true });

        assert.equal(status, 404);
        assert.deepEqual(body, SESSION_NOT_FOUND);
        assert.deepEqual(db.queries.map(({ sql }) => sql), [SESSION_ACCESS_SQL]);
        assert.deepEqual(cacheCalls, []);
    });

    it("answers an unknown session with the same 404, flushing nothing", async () => {
        const unknown = await send(STUDENT, { sessionId: UNKNOWN_ID, invalidate: true });
        const notEnrolled = await send(OUTSIDER, { invalidate: true });

        assert.equal(unknown.status, 404);
        assert.deepEqual(unknown, notEnrolled);
        assert.deepEqual(cacheCalls, []);
    });
}

// --- GET /activities/:session_id/current_phase_state -----------------------

describe("GET /activities/:session_id/current_phase_state", () => {
    refusalCases((session, options) => currentPhaseState(session, options));

    it("returns the current phase to an enrolled student, checked first", async () => {
        const { status, body } = await currentPhaseState(STUDENT);

        assert.equal(status, 200);
        assert.equal(body.phase.id, PHASE_ID);
        assert.equal(body.phase.number, 1);
        assert.equal(db.queries[0].sql, SESSION_ACCESS_SQL);
        assert.deepEqual(flushedKeys(), []);
    });

    it("lets an enrolled student flush the session's descriptor", async () => {
        const { status, body } = await currentPhaseState(STUDENT, { invalidate: true });

        assert.equal(status, 200);
        assert.equal(body.phase.id, PHASE_ID);
        assert.equal(db.queries[0].sql, SESSION_ACCESS_SQL);
        assert.deepEqual(flushedKeys(), [`descriptor:${SESSION_ID}:v2`]);
    });
});

// --- GET /activities/:id/users/:user_id/full_state -------------------------

describe("GET /activities/:id/users/:user_id/full_state", () => {
    refusalCases((session, options) => fullState(session, options));

    it("answers another user's state as an unknown session, without a query", async () => {
        const { status, body } = await fullState(STUDENT, { userId: PEER.uid, invalidate: true });

        assert.equal(status, 404);
        assert.deepEqual(body, SESSION_NOT_FOUND);
        assert.equal(db.queries.length, 0);
        assert.deepEqual(cacheCalls, []);
    });

    it("returns the full state to an enrolled student, checked first", async () => {
        const { status, body } = await fullState(STUDENT);

        assert.equal(status, 200);
        assert.equal(body.state.descriptor.currentPhaseId, PHASE_ID);
        assert.deepEqual(body.state.phases.map(({ id }) => id), [PHASE_ID]);
        assert.equal(db.queries[0].sql, SESSION_ACCESS_SQL);
        assert.deepEqual(flushedKeys(), []);
    });

    it("lets an enrolled student flush the session's keys and their own", async () => {
        const { status } = await fullState(STUDENT, { invalidate: true });

        assert.equal(status, 200);
        assert.equal(db.queries[0].sql, SESSION_ACCESS_SQL);
        assert.deepEqual(flushedKeys(), [
            `chatMessages:${SESSION_ID}:${STUDENT.uid}`,
            `descriptor:${SESSION_ID}:v2`,
            `responses:${SESSION_ID}:${STUDENT.uid}:1`,
            `session:${SESSION_ID}:phases:v2`,
            `session:${SESSION_ID}:user:${STUDENT.uid}:groups`,
            `session:${SESSION_ID}:user:${STUDENT.uid}:peer_responses:semantic_differential`,
            `tasks:${SESSION_ID}:phases:1`,
        ]);
    });
});

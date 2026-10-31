// The endpoints with which the teacher's dashboard builds and starts a phase
// answer only to the activity's owner (#905): a teacher who created the
// session and whose account is not anonymized. PostgreSQL is replaced by a
// fake pg pool that answers by matching the SQL, so nothing here needs a
// database or Redis.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import activitiesTeacherRouter from "../activities/activities-teacher.js";
import phasesRouter from "../phases.js";
import groupsRouter from "../groups.js";
import redisClient from "../../db/redis.js";
import { PHASE_OWNERSHIP_SQL, SESSION_OWNERSHIP_SQL } from "../../helpers/activity-owner-helper.js";
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
const OTHER_PHASE_ID = 200;
const FORGOTTEN_PHASE_ID = 300;
const UNKNOWN_ID = 999;

// --- Fake PostgreSQL -------------------------------------------------------

const sessions = new Map([
    [SESSION_ID, { creator: OWNER.uid }],
    [OTHER_SESSION_ID, { creator: OTHER_TEACHER.uid }],
    [FORGOTTEN_SESSION_ID, { creator: FORGOTTEN_OWNER.uid }],
]);
const phases = new Map([
    [PHASE_ID, { sesid: SESSION_ID }],
    [OTHER_PHASE_ID, { sesid: OTHER_SESSION_ID }],
    [FORGOTTEN_PHASE_ID, { sesid: FORGOTTEN_SESSION_ID }],
]);
const anonymizedUserIds = new Set([FORGOTTEN_OWNER.uid]);

function ownershipRow(sessionId, requesterId) {
    const session = sessions.get(Number(sessionId));
    if (!session) {
        return [];
    }
    const requester = Number(requesterId);
    const owned = session.creator === requester && !anonymizedUserIds.has(requester);
    return [{ session_id: Number(sessionId), owned }];
}

const GROUP_DESIGN = {
    type:   "semantic_differential",
    phases: [{ mode: "team", stdntAmount: 3, grouping_algorithm: "random" }],
};

function rowsFor(sql, params = []) {
    if (sql === SESSION_OWNERSHIP_SQL) {
        return ownershipRow(params[0], params[1]);
    }
    if (sql === PHASE_OWNERSHIP_SQL) {
        const phase = phases.get(Number(params[0]));
        return phase ? ownershipRow(phase.sesid, params[1]) : [];
    }
    if (/SELECT COUNT\(\*\)::integer\s+FROM stages\s+WHERE id = \$1\s+AND sesid = \$2/u.test(sql)) {
        return [{ count: phases.get(Number(params[0]))?.sesid === Number(params[1]) ? 1 : 0 }];
    }
    if (/SELECT current_stage, status\s+FROM sessions/u.test(sql)) {
        return [{ current_stage: null, status: 1 }];
    }
    if (sql === TRANSITION_SESSION_SQL) {
        // The write and what follows it (cache, sockets, hooks) are not part
        // of the check: answering no row stops the request at the write.
        return [];
    }
    if (/INSERT INTO stages/u.test(sql)) {
        return [{ id: 101 }];
    }
    if (/d\.design->>'type' AS design_type/u.test(sql)) {
        return [{ design_type: "semantic_differential" }];
    }
    if (/SELECT d\.design\s+FROM designs d\s+INNER JOIN activity a/u.test(sql)) {
        return [{ design: GROUP_DESIGN }];
    }
    if (/SELECT id\s+FROM stages\s+WHERE sesid = \$1/u.test(sql)) {
        return [{ id: PHASE_ID }];
    }
    if (/SELECT current_stage\s+FROM sessions/u.test(sql)) {
        return [{ current_stage: null }];
    }
    if (/FROM sesusers su\s+INNER JOIN users u/u.test(sql)) {
        return [{ uid: 41 }, { uid: 42 }];
    }
    if (/INSERT INTO teams/u.test(sql)) {
        return [{ id: 77 }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => {
    db.restore();
    // Some of these controllers import the Redis-backed caches, whose client
    // starts connecting on import. No test here reaches Redis.
    redisClient.disconnect();
});

beforeEach(() => {
    db.reset();
});

function writes() {
    return db.queries.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql)
        || sql === TRANSITION_SESSION_SQL);
}

// --- Requests --------------------------------------------------------------

function addPhase(session, sessionId = SESSION_ID) {
    return requestRouter(activitiesTeacherRouter, {
        method: "POST",
        path:   `/activities/${sessionId}/phases`,
        body:   { number: 2, type: "team", anon: true, chat: true, sesid: sessionId },
        session,
    });
}

function addItem(session, phaseId = PHASE_ID, body = {}) {
    return requestRouter(phasesRouter, {
        method: "POST",
        path:   `/phases/${phaseId}/items`,
        body:   {
            name:      "Question",
            tleft:     "Left",
            tright:    "Right",
            orden:     1,
            num:       7,
            justify:   true,
            stageId:   phaseId,
            sessionId: SESSION_ID,
            wordCount: 10,
            ...body,
        },
        session,
    });
}

function formGroups(session, phaseId = PHASE_ID) {
    return requestRouter(groupsRouter, {
        method: "POST",
        path:   `/phases/${phaseId}/groups`,
        session,
    });
}

function transition(session, { sessionId = SESSION_ID, phaseId = PHASE_ID } = {}) {
    return requestRouter(activitiesTeacherRouter, {
        method: "POST",
        path:   `/activities/${sessionId}/phase_transition`,
        body:   { phaseId },
        session,
    });
}

// --- Shared expectations ---------------------------------------------------

const DENIED = { error: "Access denied. User is not authorized for this activity." };

function refusalCases(send, { notFound, unknown, forgotten, other, invalidIdStatus = 404 }) {
    it("refuses a student without querying or writing anything", async () => {
        const { status } = await send(STUDENT);

        assert.equal(status, 403);
        assert.equal(db.queries.length, 0);
    });

    it("refuses a teacher who does not own the activity", async () => {
        const { status, body } = await send(OTHER_TEACHER);

        assert.equal(status, 403);
        assert.deepEqual(body, DENIED);
        assert.deepEqual(writes(), []);
    });

    it("refuses the owner once the account is anonymized", async () => {
        const { status, body } = await send(FORGOTTEN_OWNER, forgotten);

        assert.equal(status, 403);
        assert.deepEqual(body, DENIED);
        assert.deepEqual(writes(), []);
    });

    it("refuses the owner's request on another teacher's activity", async () => {
        const { status, body } = await send(OWNER, other);

        assert.equal(status, 403);
        assert.deepEqual(body, DENIED);
        assert.deepEqual(writes(), []);
    });

    it("answers 404 for an unknown id", async () => {
        const { status, body } = await send(OWNER, unknown);

        assert.equal(status, 404);
        assert.deepEqual(body, { error: notFound });
        assert.deepEqual(writes(), []);
    });

    it("rejects an id that is not a positive integer without querying", async () => {
        const { status } = await send(OWNER, "abc");

        assert.equal(status, invalidIdStatus);
        assert.equal(db.queries.length, 0);
    });
}

// --- Endpoints -------------------------------------------------------------

describe("POST /activities/:session_id/phases", () => {
    refusalCases((session, id) => addPhase(session, id), {
        notFound:  "Session not found.",
        unknown:   UNKNOWN_ID,
        forgotten: FORGOTTEN_SESSION_ID,
        other:     OTHER_SESSION_ID,
    });

    it("adds the phase for the owner", async () => {
        const { status, body } = await addPhase(OWNER);

        assert.equal(status, 201);
        assert.equal(body.phaseId, 101);
        const [insert] = writes();
        assert.match(insert.sql, /INSERT INTO stages/u);
        assert.equal(insert.params[4], String(SESSION_ID));
    });
});

describe("POST /phases/:id/items", () => {
    refusalCases((session, id) => addItem(session, id), {
        notFound:  "Phase not found.",
        unknown:   UNKNOWN_ID,
        forgotten: FORGOTTEN_PHASE_ID,
        other:     OTHER_PHASE_ID,
    });

    // The differential insert's creator, stageid and sesid.
    function insertedOwnership() {
        const [insert] = writes();
        assert.match(insert.sql, /INSERT INTO differential/u);
        return [insert.params[4], insert.params[5], insert.params[8]];
    }

    it("adds the item for the owner", async () => {
        const { status } = await addItem(OWNER);

        assert.equal(status, 201);
        assert.deepEqual(insertedOwnership(), [OWNER.uid, PHASE_ID, SESSION_ID]);
    });

    it("takes the phase, session and creator from the route, not the body", async () => {
        const { status } = await addItem(OWNER, PHASE_ID, {
            stageId:   OTHER_PHASE_ID,
            sessionId: OTHER_SESSION_ID,
            userId:    OTHER_TEACHER.uid,
        });

        assert.equal(status, 201);
        assert.deepEqual(insertedOwnership(), [OWNER.uid, PHASE_ID, SESSION_ID]);
    });
});

describe("POST /phases/:id/groups", () => {
    refusalCases((session, id) => formGroups(session, id), {
        notFound:  "Phase not found.",
        unknown:   UNKNOWN_ID,
        forgotten: FORGOTTEN_PHASE_ID,
        other:     OTHER_PHASE_ID,
    });

    it("forms the phase's groups for the owner", async () => {
        const { status } = await formGroups(OWNER);

        assert.equal(status, 201);
        const statements = writes()
            .map(({ sql }) => sql.trim().split(/\s+/u).slice(0, 3).join(" "));
        assert.deepEqual(statements, [
            "DELETE FROM teamusers",
            "DELETE FROM teams",
            "INSERT INTO teams",
            "INSERT INTO teamusers",
            "INSERT INTO teamusers",
        ]);
        const team = writes().find(({ sql }) => /INSERT INTO teams/u.test(sql));
        assert.deepEqual(team.params, [SESSION_ID, PHASE_ID]);
    });
});

describe("POST /activities/:session_id/phase_transition", () => {
    refusalCases((session, id) => transition(session, { sessionId: id }), {
        notFound:        "Session not found.",
        unknown:         UNKNOWN_ID,
        forgotten:       FORGOTTEN_SESSION_ID,
        other:           OTHER_SESSION_ID,
        // The route already rejected a non-numeric session id as missing.
        invalidIdStatus: 400,
    });

    it("refuses a phase of another session", async () => {
        const { status, body } = await transition(OWNER, { phaseId: OTHER_PHASE_ID });

        assert.equal(status, 400);
        assert.deepEqual(body, { error: "The phase does not exist in this session." });
        assert.deepEqual(writes(), []);
    });

    it("refuses an unknown phase", async () => {
        const { status } = await transition(OWNER, { phaseId: UNKNOWN_ID });

        assert.equal(status, 400);
        assert.deepEqual(writes(), []);
    });

    it("lets the owner reach the guarded write", async () => {
        const { status } = await transition(OWNER);

        // The fake answers the write with no row (see rowsFor).
        assert.equal(status, 404);
        const [write] = writes();
        assert.equal(write.sql, TRANSITION_SESSION_SQL);
        assert.deepEqual(write.params.slice(1), [PHASE_ID, SESSION_ID, OWNER.uid]);
    });
});

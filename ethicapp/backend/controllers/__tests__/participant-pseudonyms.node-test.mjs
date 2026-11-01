// The dashboard's owner-only reads for hiding names (#897): the students'
// pseudonym numbers (GET /sessions/:id/pseudonyms) and a phase's groups with
// each member's letter (GET /phases/:id/groups). Only the activity's owner,
// or an administrator impersonating them, may read either. PostgreSQL is
// replaced by a fake pg pool that answers by matching the SQL.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import participantPseudonymsRouter, {
    createParticipantPseudonymsRouter,
} from "../activities/participant-pseudonyms.js";
import groupsRouter from "../groups.js";
import redisClient from "../../db/redis.js";
import {
    PHASE_OWNERSHIP_SQL,
    SESSION_OWNERSHIP_SQL,
} from "../../helpers/activity-owner-helper.js";
import {
    INSERT_PSEUDONYM_SQL,
    SESSION_PSEUDONYMS_SQL,
} from "../../helpers/participant-pseudonyms-helper.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER = Object.freeze({ uid: 5, role: "P" });
const IMPERSONATING_ADMIN = Object.freeze({
    uid:           OWNER.uid,
    role:          "P",
    impersonating: true,
    authUid:       1,
    authRole:      "S",
});
const ADMIN = Object.freeze({ uid: 1, role: "S" });
const OTHER_TEACHER = Object.freeze({ uid: 6, role: "P" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });
const FORGOTTEN_OWNER = Object.freeze({ uid: 8, role: "P" });

const SESSION_ID = 10;
const FORGOTTEN_SESSION_ID = 30;
const PHASE_ID = 100;
const FORGOTTEN_PHASE_ID = 300;
const UNKNOWN_ID = 999;

const UNAUTHORIZED = { status: "err", message: "Unauthorized" };
const FORBIDDEN = { status: "err", message: "Forbidden" };

// Who may read the owner-only responses.
const READERS = [
    ["the owner", OWNER],
    ["an administrator impersonating the owner", IMPERSONATING_ADMIN],
];

// --- Fake PostgreSQL -------------------------------------------------------

const sessions = new Map([
    [SESSION_ID, { creator: OWNER.uid }],
    [FORGOTTEN_SESSION_ID, { creator: FORGOTTEN_OWNER.uid }],
]);
const phases = new Map([
    [PHASE_ID, { sessionId: SESSION_ID }],
    [FORGOTTEN_PHASE_ID, { sessionId: FORGOTTEN_SESSION_ID }],
]);
const anonymizedUserIds = new Set([FORGOTTEN_OWNER.uid]);

function owns(sessionId, requester) {
    return sessions.get(sessionId)?.creator === requester && !anonymizedUserIds.has(requester);
}

// Rows of teams LEFT JOIN teamusers for PHASE_ID: two groups and an empty one.
const TEAM_ROWS = [
    { team_id: 41, user_id: 21, anon_mask: "A" },
    { team_id: 41, user_id: 22, anon_mask: "B" },
    { team_id: 42, user_id: 23, anon_mask: "A" },
    { team_id: 42, user_id: 24, anon_mask: null },
    { team_id: 43, user_id: null, anon_mask: null },
];

function rowsFor(sql, params = []) {
    if (sql === SESSION_OWNERSHIP_SQL) {
        const sessionId = Number(params[0]);
        if (!sessions.has(sessionId)) {
            return [];
        }
        return [{ session_id: sessionId, owned: owns(sessionId, Number(params[1])) }];
    }
    if (sql === PHASE_OWNERSHIP_SQL) {
        const phase = phases.get(Number(params[0]));
        if (!phase) {
            return [];
        }
        return [{
            phase_id:   Number(params[0]),
            session_id: phase.sessionId,
            owned:      owns(phase.sessionId, Number(params[1])),
        }];
    }
    if (sql === SESSION_PSEUDONYMS_SQL) {
        return [
            { user_id: 21, number: 64, participant: true },
            { user_id: 22, number: 3, participant: true },
        ];
    }
    if (sql.includes("FROM teams AS t") && Number(params[0]) === PHASE_ID) {
        return TEAM_ROWS;
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

function fakeAssigner() {
    const calls = [];
    return {
        calls,
        assignParticipantPseudonyms: async (sessionId) => {
            calls.push(sessionId);
            return [{ userId: 22, number: 3 }, { userId: 21, number: 64 }];
        },
    };
}

let assigner = fakeAssigner();

beforeEach(() => {
    db.reset();
    assigner = fakeAssigner();
});

function readPseudonyms(session, sessionId = SESSION_ID) {
    return requestRouter(createParticipantPseudonymsRouter({ pseudonymAssigner: assigner }), {
        path: `/sessions/${sessionId}/pseudonyms`,
        session,
    });
}

function readGroups(session, phaseId = PHASE_ID) {
    return requestRouter(groupsRouter, { path: `/phases/${phaseId}/groups`, session });
}

// --- GET /sessions/:id/pseudonyms -----------------------------------------

describe("GET /sessions/:id/pseudonyms", () => {
    for (const [who, session] of READERS) {
        it(`returns the numbers to ${who}`, async () => {
            const { status, body } = await readPseudonyms(session);

            assert.equal(status, 200);
            assert.deepEqual(body, {
                pseudonyms: [{ userId: 22, number: 3 }, { userId: 21, number: 64 }],
            });
            assert.deepEqual(assigner.calls, [SESSION_ID]);
        });
    }

    for (const [who, session, status, expected] of [
        ["a request without a session user", {}, 401, UNAUTHORIZED],
        ["a student", STUDENT, 403, FORBIDDEN],
        ["an administrator who is not impersonating", ADMIN, 403, FORBIDDEN],
    ]) {
        it(`answers ${status} to ${who}, before any query`, async () => {
            const response = await readPseudonyms(session);

            assert.equal(response.status, status);
            assert.deepEqual(response.body, expected);
            assert.equal(db.queries.length, 0);
            assert.deepEqual(assigner.calls, []);
        });
    }

    for (const [who, session, sessionId] of [
        ["another teacher", OTHER_TEACHER, SESSION_ID],
        ["an owner whose account is anonymized", FORGOTTEN_OWNER, FORGOTTEN_SESSION_ID],
    ]) {
        // Answered as an unknown session (#923).
        it(`answers 404 to ${who} and assigns nothing`, async () => {
            const { status, body } = await readPseudonyms(session, sessionId);

            assert.equal(status, 404);
            assert.deepEqual(body, { error: "Session not found." });
            assert.deepEqual(db.queries.map((entry) => entry.sql), [SESSION_OWNERSHIP_SQL]);
            assert.deepEqual(assigner.calls, []);
        });
    }

    for (const sessionId of [UNKNOWN_ID, "abc"]) {
        it(`answers 404 for the session id ${sessionId}`, async () => {
            const { status, body } = await readPseudonyms(OWNER, sessionId);

            assert.equal(status, 404);
            assert.deepEqual(body, { error: "Session not found." });
            assert.deepEqual(assigner.calls, []);
        });
    }

    it("answers 500 when the assignment fails", async () => {
        const failing = {
            assignParticipantPseudonyms: async () => {
                throw new Error("Could not assign pseudonym numbers in session 10.");
            },
        };
        const { status, body } = await requestRouter(
            createParticipantPseudonymsRouter({ pseudonymAssigner: failing }),
            { path: `/sessions/${SESSION_ID}/pseudonyms`, session: OWNER }
        );

        assert.equal(status, 500);
        assert.deepEqual(body, { error: "Internal server error" });
    });

    it("reads assigned numbers with the default assigner, writing nothing", async () => {
        const { status, body } = await requestRouter(participantPseudonymsRouter, {
            path:    `/sessions/${SESSION_ID}/pseudonyms`,
            session: OWNER,
        });

        assert.equal(status, 200);
        assert.deepEqual(body, {
            pseudonyms: [{ userId: 22, number: 3 }, { userId: 21, number: 64 }],
        });
        const statements = db.queries.map((entry) => entry.sql);
        assert.ok(statements.includes(SESSION_PSEUDONYMS_SQL));
        assert.ok(!statements.includes(INSERT_PSEUDONYM_SQL));
    });
});

// --- GET /phases/:id/groups ------------------------------------------------

describe("GET /phases/:id/groups", () => {
    for (const [who, session] of READERS) {
        it(`returns the groups with each member's letter to ${who}`, async () => {
            const { status, body } = await readGroups(session);

            assert.equal(status, 200);
            assert.deepEqual(body, {
                groups: [
                    {
                        id:           41,
                        number:       1,
                        participants: [21, 22],
                        members:      [{ id: 21, anon_mask: "A" }, { id: 22, anon_mask: "B" }],
                    },
                    {
                        id:           42,
                        number:       2,
                        participants: [23, 24],
                        members:      [{ id: 23, anon_mask: "A" }, { id: 24, anon_mask: null }],
                    },
                    { id: 43, number: 3, participants: [], members: [] },
                ],
            });
            const groupsQuery = db.queries.find((entry) => entry.sql.includes("FROM teams AS t"));
            assert.deepEqual(groupsQuery.params, [PHASE_ID]);
        });
    }

    for (const [who, session, status] of [
        ["a request without a session user", {}, 401],
        ["a student", STUDENT, 403],
        ["an administrator who is not impersonating", ADMIN, 403],
    ]) {
        it(`answers ${status} to ${who}, before any query`, async () => {
            const response = await readGroups(session);

            assert.equal(response.status, status);
            assert.equal(response.body.groups, undefined);
            assert.equal(db.queries.length, 0);
        });
    }

    for (const [who, session, phaseId] of [
        ["another teacher", OTHER_TEACHER, PHASE_ID],
        ["an owner whose account is anonymized", FORGOTTEN_OWNER, FORGOTTEN_PHASE_ID],
    ]) {
        // Answered as an unknown phase (#923).
        it(`answers 404 to ${who} without reading the groups`, async () => {
            const { status, body } = await readGroups(session, phaseId);

            assert.equal(status, 404);
            assert.deepEqual(body, { error: "Phase not found." });
            assert.deepEqual(db.queries.map((entry) => entry.sql), [PHASE_OWNERSHIP_SQL]);
        });
    }

    for (const phaseId of [UNKNOWN_ID, "abc"]) {
        it(`answers 404 for the phase id ${phaseId}`, async () => {
            const { status, body } = await readGroups(OWNER, phaseId);

            assert.equal(status, 404);
            assert.deepEqual(body, { error: "Phase not found." });
        });
    }

    it("still answers 404 to the owner when the phase has no groups", async () => {
        phases.set(101, { sessionId: SESSION_ID });
        try {
            const { status, body } = await readGroups(OWNER, 101);

            assert.equal(status, 404);
            assert.deepEqual(body, { error: "No groups found for the given phase." });
        } finally {
            phases.delete(101);
        }
    });
});

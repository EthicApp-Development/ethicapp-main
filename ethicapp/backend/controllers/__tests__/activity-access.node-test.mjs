// The remaining endpoints of an activity, its phases and groups answer only to
// the activity's owner, or to a student of the session where the student app
// calls them (#910). So do the activity descriptor and the list of a
// session's users (#925). PostgreSQL is replaced by a fake pg pool that
// answers by matching the SQL, so nothing here needs a database or Redis.
// Finishing an activity is covered in
// activities/__tests__/activity-finish-route.node-test.mjs.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import activitiesCommonRouter from "../activities/activities-common.js";
import activitiesTeacherRouter from "../activities/activities-teacher.js";
import phasesRouter from "../phases.js";
import groupsRouter from "../groups.js";
import groupMessagesRouter from "../group-messages.js";
import redisClient from "../../db/redis.js";
import {
    DESIGN_LAUNCH_SQL,
    PHASE_ACCESS_SQL,
    PHASE_OWNERSHIP_SQL,
    SESSION_ACCESS_SQL,
    SESSION_OWNERSHIP_SQL,
} from "../../helpers/activity-owner-helper.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER = Object.freeze({ uid: 5, role: "P" });
const OTHER_TEACHER = Object.freeze({ uid: 6, role: "P" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });
const PEER = Object.freeze({ uid: 12, role: "A" });
const OUTSIDER = Object.freeze({ uid: 11, role: "A" });
const FORGOTTEN_STUDENT = Object.freeze({ uid: 13, role: "A" });

const SESSION_ID = 10;
const OTHER_SESSION_ID = 20;
const PHASE_ID = 100;
const OTHER_PHASE_ID = 200;
const GROUP_ID = 77;
const DESIGN_ID = 1;
const OTHER_DESIGN_ID = 2;
const UNKNOWN_ID = 999;

// --- Fake PostgreSQL -------------------------------------------------------

// A session's teacher is enrolled in it too (POST /sessions).
const sessions = new Map([
    [SESSION_ID, {
        creator:      OWNER.uid,
        participants: [OWNER.uid, STUDENT.uid, PEER.uid, FORGOTTEN_STUDENT.uid],
    }],
    [OTHER_SESSION_ID, {
        creator:      OTHER_TEACHER.uid,
        participants: [OTHER_TEACHER.uid, OUTSIDER.uid],
    }],
]);
const phases = new Map([
    [PHASE_ID, { sesid: SESSION_ID }],
    [OTHER_PHASE_ID, { sesid: OTHER_SESSION_ID }],
]);
// The other teacher's design is public: launching still needs one's own.
const designs = new Map([
    [DESIGN_ID, { creator: OWNER.uid, visibility: "private" }],
    [OTHER_DESIGN_ID, { creator: OTHER_TEACHER.uid, visibility: "public" }],
]);
const groups = new Map([
    [GROUP_ID, { stageid: PHASE_ID, members: [STUDENT.uid, PEER.uid] }],
]);
const names = new Map([[STUDENT.uid, "Ana"], [PEER.uid, "Beto"]]);
const anonymizedUserIds = new Set([FORGOTTEN_STUDENT.uid]);

function liveRequester(requesterId) {
    const requester = Number(requesterId);
    return anonymizedUserIds.has(requester) ? null : requester;
}

function ownershipRow(sessionId, requesterId) {
    const session = sessions.get(Number(sessionId));
    if (!session) {
        return [];
    }
    const owned = session.creator === liveRequester(requesterId);
    return [{ session_id: Number(sessionId), owned }];
}

function sessionAccessRow(sessionId, requesterId) {
    const session = sessions.get(Number(sessionId));
    if (!session) {
        return [];
    }
    const requester = liveRequester(requesterId);
    return [{
        session_id:  Number(sessionId),
        owned:       session.creator === requester,
        participant: session.participants.includes(requester),
    }];
}

function phaseAccessRow(phaseId, requesterId) {
    const phase = phases.get(Number(phaseId));
    if (!phase) {
        return [];
    }
    const [row] = sessionAccessRow(phase.sesid, requesterId);
    return [{ phase_id: Number(phaseId), ...row }];
}

function groupOf(phaseId, userId) {
    for (const [id, group] of groups) {
        if (group.stageid === Number(phaseId) && group.members.includes(Number(userId))) {
            return id;
        }
    }
    return null;
}

const SD_DESIGN = { type: "semantic_differential", phases: [] };
const JOIN_CODE = "JOIN42";

function rowsFor(sql, params = []) {
    const [first, second] = params.map(Number);

    if (sql === SESSION_OWNERSHIP_SQL) {
        return ownershipRow(first, second);
    }
    if (sql === PHASE_OWNERSHIP_SQL) {
        const phase = phases.get(first);
        return phase ? ownershipRow(phase.sesid, second) : [];
    }
    if (sql === PHASE_ACCESS_SQL) {
        return phaseAccessRow(first, second);
    }
    if (sql === SESSION_ACCESS_SQL) {
        return sessionAccessRow(first, second);
    }
    if (sql === DESIGN_LAUNCH_SQL) {
        const design = designs.get(first);
        return design ? [{ design_id: first, owned: design.creator === second }] : [];
    }

    // What the endpoints read once the check lets them through.
    if (/FROM users AS u\s+INNER JOIN sesusers AS su/u.test(sql)) {
        return (sessions.get(first)?.participants ?? [])
            .map(uid => ({ id: uid, name: names.get(uid) ?? null, role: "A", device: null }));
    }
    if (/d\.design->>'type' AS design_type/u.test(sql)) {
        return [{ design_type: "semantic_differential" }];
    }
    if (/FROM differential_selection AS s/u.test(sql)) {
        const response = { stageid: PHASE_ID, orden: 1, uid: STUDENT.uid, tmid: GROUP_ID };
        return [{ ...response, did: 1, sel: 3, phase_number: 1 }];
    }
    if (/FROM teams\s+WHERE id = \$1\s+AND stageid = \$2/u.test(sql)) {
        return groups.get(first)?.stageid === second ? [{ id: first }] : [];
    }
    if (/^\s*SELECT sesid\s+FROM stages\s+WHERE id = \$1\s*$/u.test(sql)) {
        const phase = phases.get(first);
        return phase ? [{ sesid: phase.sesid }] : [];
    }
    if (/FROM differential AS d\s+INNER JOIN teamusers AS tu/u.test(sql)) {
        const response = { stageid: second, orden: 1, did: 1, uid: STUDENT.uid };
        return [{ ...response, user_name: "Ana", tmid: first, sel: 3 }];
    }
    if (/grouping\s+FROM stages\s+WHERE sesid = \$1/u.test(sql)) {
        return [...phases].filter(([, phase]) => phase.sesid === first)
            .map(([id]) => ({ id, number: 1, type: "individual" }));
    }
    if (/SELECT d\.design\s+FROM designs d/u.test(sql)) {
        return [{ design: SD_DESIGN }];
    }
    if (/COUNT\(\*\) AS student_count/u.test(sql)) {
        return [{ student_count: "2" }];
    }
    if (/SELECT d\.id AS question_id, d\.justify/u.test(sql)) {
        return [{ question_id: 1, justify: false }];
    }
    if (/FROM differential_selection ds/u.test(sql)) {
        return [{ count: "1" }];
    }
    if (/FROM teams AS t\s+LEFT JOIN teamusers AS tu/u.test(sql)) {
        return [...groups].filter(([, group]) => group.stageid === first)
            .flatMap(([id, group]) => group.members.map(uid => ({ team_id: id, user_id: uid })));
    }
    if (/WHERE t\.stageid = \$1 AND tu\.uid = \$2/u.test(sql)) {
        const groupId = groupOf(first, second);
        return groupId ? [{ team_id: groupId, user_id: second, phase_anonymous: false }] : [];
    }
    if (/FROM teamusers AS tu\s+INNER JOIN users AS u/u.test(sql)) {
        return (groups.get(first)?.members ?? [])
            .map(uid => ({ user_id: uid, name: names.get(uid) }));
    }
    if (/SELECT design\s+FROM activity\s+WHERE session = \$1/u.test(sql)) {
        return [{ design: DESIGN_ID }];
    }
    if (/AS public\s+FROM designs/u.test(sql)) {
        return [{ id: first, design: SD_DESIGN }];
    }
    if (/FROM differential_chat AS c/u.test(sql)) {
        return [{ did: 1, uid: STUDENT.uid, tmid: GROUP_ID, message_count: "2" }];
    }
    if (/sessions\.code,[\s\S]*FROM activity\s+INNER JOIN sessions/u.test(sql)) {
        return [{
            id:        50,
            sessionid: first,
            creator:   sessions.get(first).creator,
            name:      "Activity",
            code:      JOIN_CODE,
            status:    2,
            designid:  DESIGN_ID,
            design:    SD_DESIGN,
        }];
    }
    if (/SELECT id, type, number\s+FROM stages\s+WHERE sesid = \$1/u.test(sql)) {
        return [...phases].filter(([, phase]) => phase.sesid === first)
            .map(([id]) => ({ id, type: "individual", number: 1 }));
    }
    if (/FROM activity\s+INNER JOIN sessions/u.test(sql)) {
        return [{ id: 50, design: SD_DESIGN }];
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
    return db.queries.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql));
}

// --- Shared expectations ---------------------------------------------------

const PHASE_NOT_FOUND = { error: "Phase not found." };

/**
 * The refusals every owner-only endpoint shares. `send(session, id)` sends
 * the request for the session or phase `id` (its own one when omitted). A
 * wrong role is refused with 403 before any lookup; a resource the requester
 * may not see is answered as an unknown one (#923).
 */
function ownerOnlyCases(send, { notFound, otherId }) {
    it("refuses a student without querying or writing anything", async () => {
        const { status } = await send(STUDENT);

        assert.equal(status, 403);
        assert.equal(db.queries.length, 0);
    });

    it("answers a teacher who does not own the activity as an unknown id", async () => {
        const { status, body } = await send(OTHER_TEACHER);

        assert.equal(status, 404);
        assert.deepEqual(body, { error: notFound });
        assert.deepEqual(writes(), []);
    });

    it("answers the owner's request on another teacher's activity as an unknown id", async () => {
        const { status, body } = await send(OWNER, otherId);

        assert.equal(status, 404);
        assert.deepEqual(body, { error: notFound });
        assert.deepEqual(writes(), []);
    });

    it("answers 404 for an unknown id", async () => {
        const { status, body } = await send(OWNER, UNKNOWN_ID);

        assert.equal(status, 404);
        assert.deepEqual(body, { error: notFound });
        assert.deepEqual(writes(), []);
    });
}

// --- Teacher endpoints of an activity --------------------------------------

describe("POST /activities", () => {
    function launch(session, { sessionId = SESSION_ID, designId = DESIGN_ID, ...extra } = {}) {
        return requestRouter(activitiesTeacherRouter, {
            method: "POST",
            path:   "/activities",
            body:   { sessionId, designId, ...extra },
            session,
        });
    }

    ownerOnlyCases((session, id) => launch(session, { sessionId: id }), {
        notFound: "Session not found.",
        otherId:  OTHER_SESSION_ID,
    });

    it("answers another teacher's design, even a public one, as unknown", async () => {
        const { status, body } = await launch(OWNER, { designId: OTHER_DESIGN_ID });

        assert.equal(status, 404);
        assert.deepEqual(body, { error: "Design not found." });
        assert.deepEqual(writes(), []);
    });

    it("answers 404 for an unknown design without writing", async () => {
        const { status, body } = await launch(OWNER, { designId: UNKNOWN_ID });

        assert.equal(status, 404);
        assert.deepEqual(body, { error: "Design not found." });
        assert.deepEqual(writes(), []);
    });

    it("launches the activity for the owner with the owner's design", async () => {
        const { status, body } = await launch(OWNER);

        assert.equal(status, 200);
        assert.equal(body.status, "ok");
        const insert = writes().find(({ sql }) => /INSERT INTO activity/u.test(sql));
        assert.deepEqual(insert.params.map(Number), [DESIGN_ID, SESSION_ID]);
    });

    // The AI services switch (#970): only `aiServices: false` turns them off.
    const storedSwitch = () => writes()
        .find(({ sql }) => /SET ai_services_enabled = \$1/u.test(sql))?.params;

    it("stores the AI services on when the launch does not turn them off", async () => {
        for (const extra of [{}, { aiServices: true }, { aiServices: "false" }, { aiServices: null }]) {
            db.reset();
            const { status } = await launch(OWNER, extra);

            assert.equal(status, 200);
            assert.deepEqual(storedSwitch(), [true, SESSION_ID]);
        }
    });

    it("stores the AI services off for aiServices: false", async () => {
        const { status, body } = await launch(OWNER, { aiServices: false });

        assert.equal(status, 200);
        assert.equal(body.status, "ok");
        assert.deepEqual(storedSwitch(), [false, SESSION_ID]);
    });
});

describe("PATCH /activities/:session_id/toggle_archived", () => {
    function toggle(session, sessionId = SESSION_ID) {
        return requestRouter(activitiesTeacherRouter, {
            method: "PATCH",
            path:   `/activities/${sessionId}/toggle_archived`,
            session,
        });
    }

    ownerOnlyCases(toggle, { notFound: "Session not found.", otherId: OTHER_SESSION_ID });

    it("toggles the owner's activity", async () => {
        const { status } = await toggle(OWNER);

        assert.equal(status, 200);
        const [update] = writes();
        assert.match(update.sql, /SET archived = NOT archived/u);
        assert.deepEqual(update.params.map(Number), [SESSION_ID]);
    });
});

describe("GET /sessions/:id/users", () => {
    function read(session, sessionId = SESSION_ID) {
        return requestRouter(activitiesTeacherRouter, {
            path: `/sessions/${sessionId}/users`,
            session,
        });
    }

    ownerOnlyCases(read, { notFound: "Session not found.", otherId: OTHER_SESSION_ID });

    it("lists the session's users to the owner", async () => {
        const { status, body } = await read(OWNER);

        assert.equal(status, 200);
        assert.deepEqual(body.users.map(({ id }) => id), sessions.get(SESSION_ID).participants);
    });

    it("answers an unknown session with the same 404 as another teacher's", async () => {
        const unknown = await read(OWNER, UNKNOWN_ID);
        const hidden = await read(OTHER_TEACHER);

        assert.deepEqual(unknown, hidden);
        assert.deepEqual(unknown, { status: 404, body: { error: "Session not found." } });
    });

    it("refuses another role with 403 before any lookup", async () => {
        const { status } = await read({ uid: 3, role: "S" });

        assert.equal(status, 403);
        assert.equal(db.queries.length, 0);
    });

    it("keeps answering 400 for an id that is not a positive integer, without querying",
        async () => {
            const { status } = await read(OWNER, "abc");

            assert.equal(status, 400);
            assert.equal(db.queries.length, 0);
        });
});

describe("GET /activities/:session_id/responses", () => {
    function read(session, sessionId = SESSION_ID) {
        return requestRouter(activitiesTeacherRouter, {
            path: `/activities/${sessionId}/responses`,
            session,
        });
    }

    ownerOnlyCases(read, { notFound: "Session not found.", otherId: OTHER_SESSION_ID });

    it("returns the responses to the owner", async () => {
        const { status, body } = await read(OWNER);

        assert.equal(status, 200);
        assert.equal(body.phases[0].phase_number, 1);
    });
});

describe("GET /activities/:session_id/phases", () => {
    function read(session, sessionId = SESSION_ID) {
        return requestRouter(activitiesTeacherRouter, {
            path: `/activities/${sessionId}/phases`,
            session,
        });
    }

    ownerOnlyCases(read, { notFound: "Session not found.", otherId: OTHER_SESSION_ID });

    it("returns the phases to the owner", async () => {
        const { status, body } = await read(OWNER);

        assert.equal(status, 200);
        assert.deepEqual(body.phases.map(({ id }) => id), [PHASE_ID]);
    });
});

describe("GET /groups/:group_id/responses", () => {
    function read(session, phaseId = PHASE_ID, groupId = GROUP_ID) {
        return requestRouter(activitiesTeacherRouter, {
            path: `/groups/${groupId}/responses?phase_id=${phaseId}`,
            session,
        });
    }

    ownerOnlyCases(read, { notFound: "Phase not found.", otherId: OTHER_PHASE_ID });

    it("returns the group's responses to the owner", async () => {
        const { status, body } = await read(OWNER);

        assert.equal(status, 200);
        assert.equal(body.responses[0].groupId, GROUP_ID);
    });

    it("answers 404 for a group of another phase", async () => {
        const { status } = await read(OWNER, PHASE_ID, UNKNOWN_ID);

        assert.equal(status, 404);
    });
});

// --- Teacher endpoints of a phase ------------------------------------------

describe("GET /phases/:id/stats", () => {
    function read(session, phaseId = PHASE_ID) {
        return requestRouter(phasesRouter, { path: `/phases/${phaseId}/stats`, session });
    }

    ownerOnlyCases(read, { notFound: "Phase not found.", otherId: OTHER_PHASE_ID });

    it("returns the statistics to the owner", async () => {
        const { status, body } = await read(OWNER);

        assert.equal(status, 200);
        assert.equal(body.expectedResponsesPerQuestion, 2);
    });
});

describe("GET /phases/:id/groups", () => {
    function read(session, phaseId = PHASE_ID) {
        return requestRouter(groupsRouter, { path: `/phases/${phaseId}/groups`, session });
    }

    ownerOnlyCases(read, { notFound: "Phase not found.", otherId: OTHER_PHASE_ID });

    it("returns the groups to the owner", async () => {
        const { status, body } = await read(OWNER);

        assert.equal(status, 200);
        assert.deepEqual(body.groups[0].participants, [STUDENT.uid, PEER.uid]);
    });
});

describe("GET /phases/:id/message_count", () => {
    function read(session, phaseId = PHASE_ID) {
        return requestRouter(groupMessagesRouter, {
            path: `/phases/${phaseId}/message_count`,
            session,
        });
    }

    ownerOnlyCases(read, { notFound: "Phase not found.", otherId: OTHER_PHASE_ID });

    it("returns the message counts to the owner", async () => {
        const { status, body } = await read(OWNER);

        assert.equal(status, 200);
        assert.equal(body.messageCount[0].messageCount, 2);
    });
});

// --- Endpoints the student app calls ---------------------------------------

describe("GET /phases/:id/user_group/:user_id", () => {
    function read(session, { phaseId = PHASE_ID, userId = session.uid } = {}) {
        return requestRouter(groupsRouter, {
            path: `/phases/${phaseId}/user_group/${userId}`,
            session,
        });
    }

    it("returns a participant student's own group with its members", async () => {
        const { status, body } = await read(STUDENT);

        assert.equal(status, 200);
        assert.equal(body.team_id, GROUP_ID);
        assert.deepEqual(body.participants.map(({ name }) => name), ["Ana", "Beto"]);
    });

    it("answers a student asking for another student as an unknown phase, without querying",
        async () => {
            const { status, body } = await read(STUDENT, { userId: PEER.uid });

            assert.equal(status, 404);
            assert.deepEqual(body, PHASE_NOT_FOUND);
            assert.equal(db.queries.length, 0);
        });

    it("answers a student who does not participate as an unknown phase", async () => {
        const { status, body } = await read(OUTSIDER);

        assert.equal(status, 404);
        assert.deepEqual(body, PHASE_NOT_FOUND);
        assert.equal(db.queries.length, 1);
    });

    it("answers a participant whose account is anonymized as an unknown phase", async () => {
        const { status, body } = await read(FORGOTTEN_STUDENT);

        assert.equal(status, 404);
        assert.deepEqual(body, PHASE_NOT_FOUND);
    });

    it("lets the owner ask for any student of the session", async () => {
        const { status, body } = await read(OWNER, { userId: PEER.uid });

        assert.equal(status, 200);
        assert.equal(body.team_id, GROUP_ID);
    });

    it("answers a teacher who does not own the activity as an unknown phase", async () => {
        const { status, body } = await read(OTHER_TEACHER, { userId: STUDENT.uid });

        assert.equal(status, 404);
        assert.deepEqual(body, PHASE_NOT_FOUND);
    });

    it("answers the owner on another teacher's phase as an unknown phase", async () => {
        const { status, body } = await read(OWNER, {
            phaseId: OTHER_PHASE_ID,
            userId:  OUTSIDER.uid,
        });

        assert.equal(status, 404);
        assert.deepEqual(body, PHASE_NOT_FOUND);
    });

    it("answers 404 for an unknown phase", async () => {
        const { status, body } = await read(STUDENT, { phaseId: UNKNOWN_ID });

        assert.equal(status, 404);
        assert.deepEqual(body, PHASE_NOT_FOUND);
    });

    it("refuses another role with 403 before any lookup", async () => {
        const { status } = await read({ uid: 3, role: "S" }, { userId: STUDENT.uid });

        assert.equal(status, 403);
        assert.equal(db.queries.length, 0);
    });
});

describe("GET /phases/:id/user_group/:user_id/previous_responses", () => {
    function read(session, { phaseId = PHASE_ID, userId = session.uid } = {}) {
        return requestRouter(groupsRouter, {
            path: `/phases/${phaseId}/user_group/${userId}/previous_responses?phase_numbers=1`,
            session,
        });
    }

    it("lets a participant student through", async () => {
        const { status } = await read(STUDENT);

        assert.equal(status, 200);
    });

    it("answers a student who does not participate as an unknown phase", async () => {
        const { status, body } = await read(OUTSIDER);

        assert.equal(status, 404);
        assert.deepEqual(body, PHASE_NOT_FOUND);
        assert.equal(db.queries.length, 1);
    });

    it("answers a student asking for another student as an unknown phase, without querying",
        async () => {
            const { status, body } = await read(STUDENT, { userId: PEER.uid });

            assert.equal(status, 404);
            assert.deepEqual(body, PHASE_NOT_FOUND);
            assert.equal(db.queries.length, 0);
        });

    it("refuses a teacher with 403 before any lookup, as before", async () => {
        const { status } = await read(OWNER, { userId: STUDENT.uid });

        assert.equal(status, 403);
        assert.equal(db.queries.length, 0);
    });

    it("answers 404 for an unknown phase", async () => {
        const { status, body } = await read(STUDENT, { phaseId: UNKNOWN_ID });

        assert.equal(status, 404);
        assert.deepEqual(body, PHASE_NOT_FOUND);
    });
});

describe("GET /activities/:session_id/descriptor", () => {
    const SESSION_NOT_FOUND = { error: "Session not found." };

    function read(session, sessionId = SESSION_ID) {
        return requestRouter(activitiesCommonRouter, {
            path: `/activities/${sessionId}/descriptor`,
            session,
        });
    }

    /** No refusal may carry the join code or the design. */
    function assertNothingLeaks(body) {
        assert.deepEqual(body, SESSION_NOT_FOUND);
        assert.doesNotMatch(JSON.stringify(body), new RegExp(JOIN_CODE, "u"));
    }

    function descriptorQueries() {
        return db.queries.filter(({ sql }) => /sessions\.code/u.test(sql));
    }

    it("returns the descriptor, with its join code and design, to the owner", async () => {
        const { status, body } = await read(OWNER);

        assert.equal(status, 200);
        assert.equal(body.descriptor.sessionId, SESSION_ID);
        assert.equal(body.descriptor.code, JOIN_CODE);
        assert.deepEqual(body.descriptor.design, SD_DESIGN);
        assert.equal(body.descriptor.status, "in_progress");
        assert.deepEqual(body.descriptor.phases.map(({ id }) => id), [PHASE_ID]);
    });

    it("returns the descriptor to a student enrolled in the session", async () => {
        const { status, body } = await read(STUDENT);

        assert.equal(status, 200);
        assert.equal(body.descriptor.sessionId, SESSION_ID);
        assert.equal(body.descriptor.currentPhase.id, PHASE_ID);
    });

    it("answers a teacher who does not own the activity as an unknown session", async () => {
        const { status, body } = await read(OTHER_TEACHER);

        assert.equal(status, 404);
        assertNothingLeaks(body);
        assert.deepEqual(descriptorQueries(), []);
    });

    it("answers the owner on another teacher's activity as an unknown session", async () => {
        const { status, body } = await read(OWNER, OTHER_SESSION_ID);

        assert.equal(status, 404);
        assertNothingLeaks(body);
        assert.deepEqual(descriptorQueries(), []);
    });

    it("answers a student of another session as an unknown session", async () => {
        const { status, body } = await read(OUTSIDER);

        assert.equal(status, 404);
        assertNothingLeaks(body);
        assert.deepEqual(descriptorQueries(), []);
    });

    it("answers an enrolled student whose account is anonymized as an unknown session",
        async () => {
            const { status, body } = await read(FORGOTTEN_STUDENT);

            assert.equal(status, 404);
            assertNothingLeaks(body);
            assert.deepEqual(descriptorQueries(), []);
        });

    it("answers an unknown session with the same 404 as a session one may not see",
        async () => {
            const unknown = await read(OWNER, UNKNOWN_ID);
            const hidden = await read(OWNER, OTHER_SESSION_ID);

            assert.equal(unknown.status, 404);
            assert.deepEqual(unknown, hidden);
            assertNothingLeaks(unknown.body);
        });

    it("refuses another role with 403 before any lookup", async () => {
        const { status } = await read({ uid: 3, role: "S" });

        assert.equal(status, 403);
        assert.equal(db.queries.length, 0);
    });

    it("keeps answering 400 for a session id that is not a number, without querying",
        async () => {
            const { status } = await read(OWNER, "abc");

            assert.equal(status, 400);
            assert.equal(db.queries.length, 0);
        });
});

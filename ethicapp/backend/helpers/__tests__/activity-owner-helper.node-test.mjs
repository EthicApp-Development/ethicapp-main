// requireSessionOwnerOrParticipant: the session's owner or a student enrolled
// in it, with accounts not anonymized (#925). The check is called directly
// with a fake response; PostgreSQL is replaced by a fake pg pool that answers
// SESSION_ACCESS_SQL from the fixtures below, so nothing here needs a
// database. The routes that use the check are covered in
// controllers/__tests__/activity-access.node-test.mjs.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import {
    PHASE_ACCESS_SQL,
    SESSION_ACCESS_SQL,
    isSessionParticipant,
    requireSessionOwnerOrParticipant,
} from "../activity-owner-helper.js";
import { installFakePgPool } from "../../controllers/__tests__/fake-pg-pool.mjs";

const OWNER = Object.freeze({ uid: 5, role: "P" });
const FORGOTTEN_OWNER = Object.freeze({ uid: 4, role: "P" });
const OTHER_TEACHER = Object.freeze({ uid: 6, role: "P" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });
const PEER = Object.freeze({ uid: 12, role: "A" });
const FORGOTTEN_STUDENT = Object.freeze({ uid: 13, role: "A" });
const OUTSIDER = Object.freeze({ uid: 11, role: "A" });

const SESSION_ID = 10;
const FORGOTTEN_OWNER_SESSION_ID = 30;
const UNKNOWN_SESSION_ID = 999;

// The other teacher is enrolled in the owner's session, as a session's
// teacher is in their own (POST /sessions): enrolment does not make a
// teacher a participant.
const sessions = new Map([
    [SESSION_ID, {
        creator:      OWNER.uid,
        participants: [OWNER.uid, OTHER_TEACHER.uid, STUDENT.uid, PEER.uid, FORGOTTEN_STUDENT.uid],
    }],
    [FORGOTTEN_OWNER_SESSION_ID, {
        creator:      FORGOTTEN_OWNER.uid,
        participants: [FORGOTTEN_OWNER.uid, STUDENT.uid],
    }],
]);
const anonymizedUserIds = new Set([FORGOTTEN_OWNER.uid, FORGOTTEN_STUDENT.uid]);

// What SESSION_ACCESS_SQL answers: no row for an unknown session, and both
// flags false for an anonymized requester, who is not joined.
function rowsFor(sql, params = []) {
    if (sql !== SESSION_ACCESS_SQL) {
        return [];
    }
    const [sessionId, requesterId] = params.map(Number);
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

const db = installFakePgPool(rowsFor);

after(() => {
    db.restore();
});

beforeEach(() => {
    db.reset();
});

function fakeResponse() {
    return {
        statusCode: null,
        body:       undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

async function check(session, sessionId = SESSION_ID, options) {
    const res = fakeResponse();
    const result = await requireSessionOwnerOrParticipant({ session }, res, sessionId, options);
    return { result, res };
}

const SESSION_NOT_FOUND = { error: "Session not found." };

function assertNotFound({ result, res }) {
    assert.equal(result, null);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, SESSION_NOT_FOUND);
}

describe("requireSessionOwnerOrParticipant", () => {
    it("lets the owner through and sends nothing", async () => {
        const { result, res } = await check(OWNER);

        assert.deepEqual(result, { sessionId: SESSION_ID });
        assert.equal(res.statusCode, null);
    });

    it("lets a student enrolled in the session through", async () => {
        const { result, res } = await check(STUDENT, String(SESSION_ID));

        assert.deepEqual(result, { sessionId: SESSION_ID });
        assert.equal(res.statusCode, null);
    });

    it("answers an anonymized owner as an unknown session", async () => {
        assertNotFound(await check(FORGOTTEN_OWNER, FORGOTTEN_OWNER_SESSION_ID));
    });

    it("answers another teacher, enrolled in the session, as an unknown session", async () => {
        assertNotFound(await check(OTHER_TEACHER));
    });

    it("answers an anonymized student enrolled in the session as an unknown session", async () => {
        assertNotFound(await check(FORGOTTEN_STUDENT));
    });

    it("answers a student not enrolled in the session as an unknown session", async () => {
        assertNotFound(await check(OUTSIDER));
    });

    it("answers an unknown session with the same 404", async () => {
        assertNotFound(await check(OWNER, UNKNOWN_SESSION_ID));
    });

    it("answers an id that is not a positive integer as unknown, without querying", async () => {
        for (const id of ["abc", "1.5", "0", "-3", null]) {
            assertNotFound(await check(OWNER, id));
        }
        assert.equal(db.queries.length, 0);
    });

    it("refuses another role with 403 before any lookup", async () => {
        const { result, res } = await check({ uid: 3, role: "S" });

        assert.equal(result, null);
        assert.equal(res.statusCode, 403);
        assert.equal(db.queries.length, 0);
    });

    it("refuses a request without a signed-in user with 401 before any lookup", async () => {
        const { result, res } = await check({});

        assert.equal(result, null);
        assert.equal(res.statusCode, 401);
        assert.equal(db.queries.length, 0);
    });

    describe("with subjectUserId", () => {
        it("lets a student ask for themselves", async () => {
            const { result } = await check(STUDENT, SESSION_ID, { subjectUserId: STUDENT.uid });

            assert.deepEqual(result, { sessionId: SESSION_ID });
        });

        it("answers a student asking for another user as unknown, without querying", async () => {
            assertNotFound(await check(STUDENT, SESSION_ID, { subjectUserId: PEER.uid }));
            assert.equal(db.queries.length, 0);
        });

        it("lets the owner ask for any user", async () => {
            const { result } = await check(OWNER, SESSION_ID, { subjectUserId: PEER.uid });

            assert.deepEqual(result, { sessionId: SESSION_ID });
        });
    });

    it("looks the session up with SESSION_ACCESS_SQL, by session and requester", async () => {
        await check(STUDENT);

        assert.equal(db.queries.length, 1);
        const [{ sql, params }] = db.queries;
        assert.equal(sql, SESSION_ACCESS_SQL);
        assert.deepEqual(params.map(Number), [SESSION_ID, STUDENT.uid]);
    });
});

describe("SESSION_ACCESS_SQL", () => {
    it("joins the requester only while the account is not anonymized", () => {
        assert.match(SESSION_ACCESS_SQL, /requester\.anonymized_at IS NULL/u);
    });

    it("reads the owner from sessions.creator and enrolment from sesusers", () => {
        assert.match(SESSION_ACCESS_SQL, /s\.creator = requester\.id/u);
        assert.match(
            SESSION_ACCESS_SQL,
            /FROM sesusers AS su\s+WHERE su\.sesid = s\.id\s+AND su\.uid = requester\.id/u,
        );
    });

    it("shares its owner and participant columns with PHASE_ACCESS_SQL", () => {
        const columns = (sql) => sql.slice(sql.indexOf("COALESCE"), sql.indexOf("AS participant"));

        assert.equal(columns(SESSION_ACCESS_SQL), columns(PHASE_ACCESS_SQL));
    });
});

// The participant half of the rule, for the response submission policy (#927).
describe("isSessionParticipant", () => {
    it("is true for a student enrolled in the session", async () => {
        assert.equal(await isSessionParticipant(SESSION_ID, STUDENT.uid), true);

        assert.equal(db.queries.length, 1);
        const [{ sql, params }] = db.queries;
        assert.equal(sql, SESSION_ACCESS_SQL);
        assert.deepEqual(params.map(Number), [SESSION_ID, STUDENT.uid]);
    });

    it("is false for an anonymized student, an outsider and an unknown session", async () => {
        assert.equal(await isSessionParticipant(SESSION_ID, FORGOTTEN_STUDENT.uid), false);
        assert.equal(await isSessionParticipant(SESSION_ID, OUTSIDER.uid), false);
        assert.equal(await isSessionParticipant(UNKNOWN_SESSION_ID, STUDENT.uid), false);
    });

    it("is false for an id that is not a positive integer, without querying", async () => {
        for (const id of ["abc", "1.5", "0", "-3", null]) {
            assert.equal(await isSessionParticipant(id, STUDENT.uid), false);
        }
        assert.equal(db.queries.length, 0);
    });
});

// GET /activities/:session_id/clock (#1111, epic #1105): the phase clock the
// teacher's dashboard and the student app count down from. Only the
// activity's owner and its participants read it, with the rule of
// requireSessionOwnerOrParticipant, and it is never cached. PostgreSQL is
// replaced by a fake pg pool that answers by matching the SQL, so the real
// clock reader and its mapping run without a database. The SQL itself is
// covered by helpers/__tests__/phase-clock.integration-test.mjs.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import express from "express";

import { createPhaseClockRouter } from "../phase-clock.js";
import { SESSION_ACCESS_SQL } from "../../../helpers/activity-owner-helper.js";
import { PHASE_CLOCK_SQL } from "../../../helpers/phase-clock.js";
import { installFakePgPool } from "../../__tests__/fake-pg-pool.mjs";

const OWNER = Object.freeze({ uid: 5, role: "P" });
const OTHER_TEACHER = Object.freeze({ uid: 6, role: "P" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });
const OUTSIDER = Object.freeze({ uid: 11, role: "A" });
const FORGOTTEN_STUDENT = Object.freeze({ uid: 13, role: "A" });
const SUPER_ADMIN = Object.freeze({ uid: 3, role: "S" });

const SESSION_ID = 10;
const OTHER_SESSION_ID = 20;
const UNKNOWN_ID = 999;

const SESSION_NOT_FOUND = Object.freeze({ error: "Session not found." });
const UNAUTHORIZED = Object.freeze({ status: "err", message: "Unauthorized" });
const FORBIDDEN = Object.freeze({ status: "err", message: "Forbidden" });

const STARTED_AT = new Date("2026-11-11T10:00:00.000Z");
const ENDS_AT = new Date("2026-11-11T10:05:00.000Z");
const SERVER_NOW = new Date("2026-11-11T10:01:30.250Z");

// --- Fake PostgreSQL -------------------------------------------------------

// A session's teacher is enrolled in it too (POST /sessions). OTHER_TEACHER
// is enrolled in SESSION_ID without owning it.
const sessions = new Map([
    [SESSION_ID, {
        creator:      OWNER.uid,
        participants: [OWNER.uid, OTHER_TEACHER.uid, STUDENT.uid, FORGOTTEN_STUDENT.uid],
    }],
    [OTHER_SESSION_ID, { creator: 99, participants: [99, OUTSIDER.uid] }],
]);
const anonymizedUserIds = new Set([FORGOTTEN_STUDENT.uid]);

// The PHASE_CLOCK_SQL row of SESSION_ID, which each test sets.
let clockRow;

function timedPhaseRow(overrides = {}) {
    return {
        session_id:         SESSION_ID,
        time_mode:          "soft",
        status:             2,
        phase_id:           101,
        phase_number:       2,
        started_at:         STARTED_AT,
        ends_at:            ENDS_AT,
        design_phase_count: 3,
        server_now:         SERVER_NOW,
        ...overrides,
    };
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
    if (sql === PHASE_CLOCK_SQL) {
        return first === SESSION_ID && clockRow ? [clockRow] : [];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
}

const db = installFakePgPool(rowsFor);

after(() => {
    db.restore();
});

beforeEach(() => {
    db.reset();
    clockRow = timedPhaseRow();
});

async function getClock(session, sessionId = SESSION_ID, router = createPhaseClockRouter()) {
    const app = express();
    app.use((req, res, next) => {
        req.session = session ?? undefined;
        next();
    });
    app.use(router);

    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const { port } = server.address();
    try {
        const response = await fetch(`http://127.0.0.1:${port}/activities/${sessionId}/clock`);
        return {
            status:       response.status,
            body:         await response.json(),
            cacheControl: response.headers.get("cache-control"),
        };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

const clockReads = () => db.queries.filter(query => query.sql === PHASE_CLOCK_SQL);

// --- Access ----------------------------------------------------------------

describe("who reads the clock", () => {
    const TIMED_CLOCK = {
        sessionId:   SESSION_ID,
        timeMode:    "soft",
        finished:    false,
        phaseId:     101,
        phaseNumber: 2,
        startedAt:   "2026-11-11T10:00:00.000Z",
        endsAt:      "2026-11-11T10:05:00.000Z",
        isLastPhase: false,
        serverNow:   "2026-11-11T10:01:30.250Z",
    };

    it("answers the activity's owner", async () => {
        const response = await getClock(OWNER);

        assert.equal(response.status, 200);
        assert.deepEqual(response.body, TIMED_CLOCK);
        assert.deepEqual(clockReads().map(query => query.params), [[SESSION_ID]]);
    });

    it("answers a participant with the same clock", async () => {
        const response = await getClock(STUDENT);

        assert.equal(response.status, 200);
        assert.deepEqual(response.body, TIMED_CLOCK);
    });

    it("refuses a request without a session before any lookup", async () => {
        const response = await getClock(null);

        assert.equal(response.status, 401);
        assert.deepEqual(response.body, UNAUTHORIZED);
        assert.deepEqual(db.queries, []);
    });

    it("refuses a role other than a teacher's or a student's before any lookup", async () => {
        const response = await getClock(SUPER_ADMIN);

        assert.equal(response.status, 403);
        assert.deepEqual(response.body, FORBIDDEN);
        assert.deepEqual(db.queries, []);
    });

    // As every owner-or-participant read: the same 404 as an unknown session,
    // so the answer does not reveal that the activity exists (#923).
    it("answers another teacher, even one enrolled in it, as an unknown session", async () => {
        const response = await getClock(OTHER_TEACHER);

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, SESSION_NOT_FOUND);
        assert.deepEqual(clockReads(), []);
    });

    it("answers a student of another session as an unknown session", async () => {
        const response = await getClock(OUTSIDER);

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, SESSION_NOT_FOUND);
        assert.deepEqual(clockReads(), []);
    });

    it("answers an anonymized participant as an unknown session", async () => {
        const response = await getClock(FORGOTTEN_STUDENT);

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, SESSION_NOT_FOUND);
        assert.deepEqual(clockReads(), []);
    });

    it("answers an unknown session and an id that is not one with 404", async () => {
        for (const sessionId of [UNKNOWN_ID, "abc", 0]) {
            const response = await getClock(OWNER, sessionId);

            assert.equal(response.status, 404, String(sessionId));
            assert.deepEqual(response.body, SESSION_NOT_FOUND);
        }
        assert.deepEqual(clockReads(), []);
    });

    it("is never cached, whatever the answer", async () => {
        for (const session of [OWNER, STUDENT, OUTSIDER, SUPER_ADMIN, null]) {
            const response = await getClock(session);
            assert.equal(response.cacheControl, "no-store", JSON.stringify(session));
        }
    });

    it("answers 500 when the clock cannot be read", async () => {
        const router = createPhaseClockRouter({
            readClock: async () => {
                throw new Error("database down");
            },
        });
        const originalError = console.error;
        console.error = () => {};
        try {
            const response = await getClock(OWNER, SESSION_ID, router);
            assert.equal(response.status, 500);
            assert.deepEqual(response.body, { error: "Internal server error" });
        } finally {
            console.error = originalError;
        }
    });

    it("answers 404 when the session is gone by the time the clock is read", async () => {
        clockRow = null;
        const response = await getClock(OWNER);

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, SESSION_NOT_FOUND);
    });
});

// --- Edge cases ------------------------------------------------------------

describe("the clock's edge cases", () => {
    it("has no phase before the first phase starts", async () => {
        clockRow = timedPhaseRow({
            status:       1,
            phase_id:     null,
            phase_number: null,
            started_at:   null,
            ends_at:      null,
        });

        const { body } = await getClock(STUDENT);

        assert.deepEqual(body, {
            sessionId:   SESSION_ID,
            timeMode:    "soft",
            finished:    false,
            phaseId:     null,
            phaseNumber: null,
            startedAt:   null,
            endsAt:      null,
            isLastPhase: null,
            serverNow:   "2026-11-11T10:01:30.250Z",
        });
    });

    it("has no deadline for a phase without a duration", async () => {
        clockRow = timedPhaseRow({ time_mode: "hard", ends_at: null });

        const { body } = await getClock(OWNER);

        assert.equal(body.timeMode, "hard");
        assert.equal(body.startedAt, "2026-11-11T10:00:00.000Z");
        assert.equal(body.endsAt, null);
    });

    it("has no deadline in an activity without a time mode", async () => {
        // Starting a phase writes no deadline for "none"; one written anyway
        // is not shown.
        clockRow = timedPhaseRow({ time_mode: "none" });

        const { body } = await getClock(OWNER);

        assert.equal(body.timeMode, "none");
        assert.equal(body.phaseId, 101);
        assert.equal(body.endsAt, null);
    });

    it("says when the current phase is the design's last one", async () => {
        clockRow = timedPhaseRow({ time_mode: "hard", phase_number: 3, design_phase_count: 3 });

        const { body } = await getClock(STUDENT);

        assert.equal(body.isLastPhase, true);
        assert.equal(body.endsAt, "2026-11-11T10:05:00.000Z");
    });

    it("keeps a deadline that has passed, earlier than the server's time", async () => {
        clockRow = timedPhaseRow({ server_now: new Date("2026-11-11T10:07:15.000Z") });

        const { body } = await getClock(OWNER);

        assert.equal(body.endsAt, "2026-11-11T10:05:00.000Z");
        assert.equal(body.serverNow, "2026-11-11T10:07:15.000Z");
    });

    it("says the activity is finished, without a current phase", async () => {
        clockRow = timedPhaseRow({
            status:       3,
            phase_id:     null,
            phase_number: null,
            started_at:   null,
            ends_at:      null,
        });

        const { body } = await getClock(STUDENT);

        assert.equal(body.finished, true);
        assert.equal(body.timeMode, "soft");
        assert.deepEqual(
            [body.phaseId, body.phaseNumber, body.startedAt, body.endsAt, body.isLastPhase],
            [null, null, null, null, null]
        );
    });
});

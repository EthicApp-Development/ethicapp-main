// PATCH /activities/:session_id/archive (#1048, epic #1046): only a finished
// activity can be archived, restoring is always allowed, and the route sets
// the flag it is asked for instead of flipping it. PostgreSQL is replaced by
// a fake pg pool that keeps each session's status and archived flag and
// answers SET_SESSION_ARCHIVED_SQL as PostgreSQL would.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it, mock } from "node:test";

import activitiesTeacherRouter, { SET_SESSION_ARCHIVED_SQL } from "../activities-teacher.js";
import redisClient from "../../../db/redis.js";
import { SESSION_OWNERSHIP_SQL } from "../../../helpers/activity-owner-helper.js";
import { getStatusCode } from "../../../../common/modules/session-status.js";
import { installFakePgPool, requestRouter } from "../../__tests__/fake-pg-pool.mjs";

const TEACHER = Object.freeze({ uid: 5, role: "P" });
const OTHER_TEACHER = Object.freeze({ uid: 6, role: "P" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });

const FINISHED_ID = 41;
const IN_PROGRESS_ID = 42;
const INITIATED_ID = 43;
const NO_STATUS_ID = 44;
// Owned by the teacher, but gone by the time the update runs.
const VANISHING_ID = 45;
const UNKNOWN_ID = 999;

let sessions;

function teacherSession(status) {
    return { creator: TEACHER.uid, status, archived: false };
}

function resetSessions() {
    sessions = new Map([
        [FINISHED_ID, teacherSession(getStatusCode("finished"))],
        [IN_PROGRESS_ID, teacherSession(getStatusCode("in_progress"))],
        [INITIATED_ID, teacherSession(getStatusCode("initiated"))],
        [NO_STATUS_ID, teacherSession(null)],
    ]);
}

const db = installFakePgPool((sql, params = []) => {
    if (sql === SESSION_OWNERSHIP_SQL) {
        const [sessionId, requesterId] = params.map(Number);
        if (sessionId === VANISHING_ID) {
            return [{ session_id: sessionId, owned: requesterId === TEACHER.uid }];
        }
        const session = sessions.get(sessionId);
        return session ? [{ session_id: sessionId, owned: session.creator === requesterId }] : [];
    }
    if (sql === SET_SESSION_ARCHIVED_SQL) {
        const [sessionId, archived, finishedStatus] = params;
        const session = sessions.get(Number(sessionId));
        if (!session) {
            return [];
        }
        // NULL = $3 is not true, so a session without a status is not finished.
        const updated = archived === false || session.status === finishedStatus;
        if (updated) {
            session.archived = archived;
        }
        return [{
            session_id: Number(sessionId),
            updated,
            archived:   updated ? session.archived : null,
        }];
    }
    return [];
});

after(() => {
    db.restore();
    // The teacher controller imports the Redis-backed descriptor cache, whose
    // client starts connecting on import. No test here reaches Redis.
    redisClient.disconnect();
});

beforeEach(() => {
    resetSessions();
    db.reset();
    mock.restoreAll();
});

function setArchived(session, sessionId, body) {
    return requestRouter(activitiesTeacherRouter, {
        method: "PATCH",
        path:   `/activities/${sessionId}/archive`,
        body,
        session,
    });
}

function archiveStatements() {
    return db.queries.filter(({ sql }) => sql === SET_SESSION_ARCHIVED_SQL);
}

const NOT_FINISHED = {
    status:  "err",
    message: "Only a finished activity can be archived.",
    code:    "ACTIVITY_NOT_FINISHED",
};

describe("PATCH /activities/:session_id/archive", () => {
    it("archives a finished activity and answers its flag", async () => {
        const { status, body } = await setArchived(TEACHER, FINISHED_ID, { archived: true });

        assert.equal(status, 200);
        assert.deepEqual(body, { status: "ok", result: { id: FINISHED_ID, archived: true } });
        assert.equal(sessions.get(FINISHED_ID).archived, true);

        const [statement] = archiveStatements();
        assert.deepEqual(statement.params, [FINISHED_ID, true, getStatusCode("finished")]);
    });

    it("checks the status in the update's own WHERE", () => {
        const update = new RegExp([
            "UPDATE sessions",
            "SET archived = \\$2::boolean",
            "WHERE id = \\$1",
            "AND \\(NOT \\$2::boolean OR status = \\$3\\)",
        ].join("\\s+"), "u");
        assert.match(SET_SESSION_ARCHIVED_SQL, update);
    });

    for (const [label, sessionId] of [
        ["in progress", IN_PROGRESS_ID],
        ["not started", INITIATED_ID],
        ["without a status", NO_STATUS_ID],
    ]) {
        it(`refuses to archive an activity ${label} with 409 ACTIVITY_NOT_FINISHED`, async () => {
            const { status, body } = await setArchived(TEACHER, sessionId, { archived: true });

            assert.equal(status, 409);
            assert.deepEqual(body, NOT_FINISHED);
            assert.equal(sessions.get(sessionId).archived, false);
        });
    }

    it("restores an archived activity", async () => {
        sessions.get(FINISHED_ID).archived = true;

        const { status, body } = await setArchived(TEACHER, FINISHED_ID, { archived: false });

        assert.equal(status, 200);
        assert.deepEqual(body, { status: "ok", result: { id: FINISHED_ID, archived: false } });
        assert.equal(sessions.get(FINISHED_ID).archived, false);
    });

    it("restores an unfinished activity, which the old toggle could archive", async () => {
        sessions.get(IN_PROGRESS_ID).archived = true;

        const { status, body } = await setArchived(TEACHER, IN_PROGRESS_ID, { archived: false });

        assert.equal(status, 200);
        assert.deepEqual(body.result, { id: IN_PROGRESS_ID, archived: false });
        assert.equal(sessions.get(IN_PROGRESS_ID).archived, false);
    });

    it("leaves the flag as asked when the same request is sent twice", async () => {
        const first = await setArchived(TEACHER, FINISHED_ID, { archived: true });
        const second = await setArchived(TEACHER, FINISHED_ID, { archived: true });

        assert.deepEqual(second, first);
        assert.equal(sessions.get(FINISHED_ID).archived, true);

        const restored = await setArchived(TEACHER, FINISHED_ID, { archived: false });
        const restoredAgain = await setArchived(TEACHER, FINISHED_ID, { archived: false });

        assert.deepEqual(restoredAgain, restored);
        assert.equal(sessions.get(FINISHED_ID).archived, false);
    });

    for (const body of [{}, { archived: "true" }, { archived: 1 }, { archived: null }]) {
        it(`answers 400 for ${JSON.stringify(body)} without querying`, async () => {
            const response = await setArchived(TEACHER, FINISHED_ID, body);

            assert.equal(response.status, 400);
            assert.deepEqual(response.body, {
                status:  "err",
                message: "archived must be a boolean.",
            });
            assert.equal(db.queries.length, 0);
        });
    }

    it("answers another teacher as for an unknown session, changing nothing", async () => {
        const hidden = await setArchived(OTHER_TEACHER, FINISHED_ID, { archived: true });
        const unknown = await setArchived(TEACHER, UNKNOWN_ID, { archived: true });

        // The same answer as an unknown session (#923).
        assert.deepEqual(hidden, { status: 404, body: { error: "Session not found." } });
        assert.deepEqual(unknown, hidden);
        assert.deepEqual(archiveStatements(), []);
        assert.equal(sessions.get(FINISHED_ID).archived, false);
    });

    it("refuses a student with 403 before any lookup", async () => {
        const { status } = await setArchived(STUDENT, FINISHED_ID, { archived: true });

        assert.equal(status, 403);
        assert.equal(db.queries.length, 0);
    });

    it("answers 404 when the session is gone by the time of the update", async () => {
        const { status, body } = await setArchived(TEACHER, VANISHING_ID, { archived: true });

        assert.equal(status, 404);
        assert.deepEqual(body, { error: "Session not found." });
    });

    it("answers 500 when the update fails", async () => {
        mock.method(console, "error", () => {});
        const failing = installFakePgPool(() => {
            throw new Error("connection lost");
        });

        try {
            const { status, body } = await setArchived(TEACHER, FINISHED_ID, { archived: true });

            assert.equal(status, 500);
            assert.deepEqual(body, { status: "err", message: "Internal Server Error" });
        } finally {
            failing.restore();
        }
    });
});

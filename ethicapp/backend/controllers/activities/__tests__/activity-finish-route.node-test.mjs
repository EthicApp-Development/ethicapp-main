// The teacher's "finish" route (#881) goes through the shared activity
// finisher. The finisher's own steps are covered in
// helpers/__tests__/activity-finish-helper.node-test.mjs; this checks how the
// route maps its outcomes, and that only the activity's owner reaches the
// finisher (#910). PostgreSQL is replaced by a fake pg pool that answers the
// owner check.
import assert from "node:assert/strict";
import { after, afterEach, describe, it, mock } from "node:test";
import express from "express";

import activitiesTeacherRouter from "../activities-teacher.js";
import activityFinisher from "../../../helpers/activity-finish-helper.js";
import redisClient from "../../../db/redis.js";
import { SESSION_OWNERSHIP_SQL } from "../../../helpers/activity-owner-helper.js";
import { installFakePgPool } from "../../__tests__/fake-pg-pool.mjs";

const TEACHER = Object.freeze({ uid: 5, role: "P" });
const OTHER_TEACHER = Object.freeze({ uid: 6, role: "P" });
const SESSION_ID = 42;

const db = installFakePgPool((sql, params = []) => {
    if (sql === SESSION_OWNERSHIP_SQL && Number(params[0]) === SESSION_ID) {
        return [{ session_id: SESSION_ID, owned: Number(params[1]) === TEACHER.uid }];
    }
    return [];
});

// The teacher controller imports the Redis-backed descriptor cache, whose
// client starts connecting on import. No test here reaches Redis.
after(() => {
    db.restore();
    redisClient.disconnect();
});

afterEach(() => {
    mock.restoreAll();
});

async function postFinish(session, sessionId = "42") {
    const app = express();
    app.use((req, res, next) => {
        req.session = session;
        next();
    });
    app.use(activitiesTeacherRouter);

    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const { port } = server.address();

    try {
        const response = await fetch(`http://127.0.0.1:${port}/activities/${sessionId}/finish`, {
            method:  "POST",
            headers: { Accept: "application/json" },
        });
        return { status: response.status, body: await response.json() };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

describe("POST /activities/:session_id/finish", () => {
    it("finishes the activity through the shared finisher", async () => {
        const finish = mock.method(activityFinisher, "finishActivity", async sessionId => ({
            status: "finished", sessionId: Number(sessionId), previousPhaseId: 3,
        }));

        const { status, body } = await postFinish(TEACHER);

        assert.equal(status, 200);
        assert.deepEqual(body, { status: "ok", message: "Activity session finished successfully." });
        assert.equal(finish.mock.callCount(), 1);
        assert.deepEqual(finish.mock.calls[0].arguments, ["42"]);
    });

    it("answers 404 for a missing session", async () => {
        mock.method(activityFinisher, "finishActivity", async () => ({ status: "not_found", sessionId: 42 }));

        const { status, body } = await postFinish(TEACHER);

        assert.equal(status, 404);
        assert.deepEqual(body, { error: "Session not found." });
    });

    it("answers 404 when the update changed no row", async () => {
        mock.method(activityFinisher, "finishActivity", async () => ({ status: "not_updated", sessionId: 42 }));

        const { status, body } = await postFinish(TEACHER);

        assert.equal(status, 404);
        assert.deepEqual(body, { error: "Session not found or no update performed." });
    });

    it("answers 500 when finishing fails", async () => {
        mock.method(console, "error", () => {});
        mock.method(activityFinisher, "finishActivity", async () => {
            throw new Error("phase-ended failed");
        });

        const { status, body } = await postFinish(TEACHER);

        assert.equal(status, 500);
        assert.deepEqual(body, { error: "Internal server error" });
    });

    it("refuses a student session without finishing anything", async () => {
        const finish = mock.method(activityFinisher, "finishActivity", async () => {
            throw new Error("must not be called");
        });

        const { status } = await postFinish({ uid: 9, role: "A" });

        assert.equal(status, 403);
        assert.equal(finish.mock.callCount(), 0);
    });

    it("answers another teacher as for an unknown session, finishing nothing", async () => {
        const finish = mock.method(activityFinisher, "finishActivity", async () => {
            throw new Error("must not be called");
        });

        const { status, body } = await postFinish(OTHER_TEACHER);

        // The same answer as an unknown session (#923).
        assert.equal(status, 404);
        assert.deepEqual(body, { error: "Session not found." });
        assert.equal(finish.mock.callCount(), 0);
    });

    it("answers 404 for an unknown session without finishing anything", async () => {
        const finish = mock.method(activityFinisher, "finishActivity", async () => {
            throw new Error("must not be called");
        });

        const { status, body } = await postFinish(TEACHER, "999");

        assert.equal(status, 404);
        assert.deepEqual(body, { error: "Session not found." });
        assert.equal(finish.mock.callCount(), 0);
    });
});

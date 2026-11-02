// The teacher's POST /sessions (#968, epic #965): a launch requires an
// activity description, since activities launched from the same design differ
// only by it. PostgreSQL is replaced by a fake pg pool.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import activitiesTeacherRouter from "../activities-teacher.js";
import redisClient from "../../../db/redis.js";
import { CREATE_SESSION_SQL } from "../../../helpers/teacher-activity-writes.js";
import { installFakePgPool, requestRouter } from "../../__tests__/fake-pg-pool.mjs";

const TEACHER = Object.freeze({ uid: 5, role: "P" });
const SESSION_ID = 42;

const db = installFakePgPool((sql) => {
    if (sql === CREATE_SESSION_SQL) {
        return [{ id: SESSION_ID }];
    }
    return [];
});

// The teacher controller imports the Redis-backed descriptor cache, whose
// client starts connecting on import. No test here reaches Redis.
after(() => {
    db.restore();
    redisClient.disconnect();
});

beforeEach(() => {
    db.reset();
});

function postSession(body, session = TEACHER) {
    return requestRouter(activitiesTeacherRouter, {
        method: "POST", path: "/sessions", body, session,
    });
}

const DESCRIPTION_REQUIRED = {
    status:  "err",
    message: "The activity needs a description.",
    code:    "ACTIVITY_DESCRIPTION_REQUIRED",
};

describe("POST /sessions", () => {
    for (const [label, description] of [
        ["missing", undefined],
        ["empty", ""],
        ["blank", "  \t\n "],
        ["not a string", 7],
    ]) {
        it(`answers 400 ACTIVITY_DESCRIPTION_REQUIRED when it is ${label}`, async () => {
            const { status, body } = await postSession({ name: "Privacy", type: "T", description });

            assert.equal(status, 400);
            assert.deepEqual(body, DESCRIPTION_REQUIRED);
            assert.equal(db.queries.length, 0);
        });
    }

    it("stores the trimmed description", async () => {
        const { status, body } = await postSession({
            name:        "Privacy in health apps",
            type:        "T",
            description: "  Professional Ethics · Section 3 · 2026-2 \n",
        });

        assert.equal(status, 201);
        assert.deepEqual(body, { status: "ok", id: SESSION_ID });

        const create = db.queries.find(query => query.sql === CREATE_SESSION_SQL);
        assert.deepEqual(create.params, [
            "Privacy in health apps", "Professional Ethics · Section 3 · 2026-2", TEACHER.uid, "T",
        ]);
        assert.equal(db.queries.length, 2);
    });

    it("still answers 400 for a missing name or type before the description", async () => {
        const { status, body } = await postSession({ type: "T", description: "" });

        assert.equal(status, 400);
        assert.deepEqual(body, { status: "err", message: "Missing required session fields." });
    });
});

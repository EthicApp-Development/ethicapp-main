// The teacher's GET /activities (#1049, epic #1046): one statement for the
// whole list, with the teacher's id, and each row mapped with the current
// phase, the phase count, the participants, the AI services switch, the time
// mode and the end time. PostgreSQL is replaced by a fake pg pool.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import activitiesTeacherRouter from "../activities-teacher.js";
import redisClient from "../../../db/redis.js";
import { TEACHER_ACTIVITIES_SQL } from "../../../helpers/teacher-activity-list.js";
import { installFakePgPool, requestRouter } from "../../__tests__/fake-pg-pool.mjs";

const TEACHER = Object.freeze({ uid: 5, role: "P" });
// A row as PostgreSQL would answer it if the statement still selected the
// design document: the route must not pass it on (#1055).
const DESIGN = Object.freeze({ metainfo: { title: "Privacy" }, phases: [{}, {}] });

const BASE_ROW = Object.freeze({
    creator:            5,
    name:               "Privacy",
    design:             DESIGN,
    type:               "T",
    designId:           7,
    designTitle:        "Privacy",
    currentPhaseNumber: null,
    currentPhaseMode:   null,
    phaseCount:         2,
});

const NOT_STARTED_ROW = Object.freeze({
    ...BASE_ROW,
    id:                  12,
    sessionId:           43,
    description:         "Section 4",
    time:                "2026-11-03T09:00:00.000Z",
    code:                "DEF456",
    archived:            false,
    status:              1,
    ai_services_enabled: false,
    time_mode:           "none",
    finishedAt:          null,
    participantCount:    0,
    caseId:              null,
    caseTitle:           null,
});

const FINISHED_ROW = Object.freeze({
    ...BASE_ROW,
    id:                  11,
    sessionId:           42,
    description:         "Section 3",
    time:                "2026-11-02T18:01:00.000Z",
    code:                "ABC123",
    archived:            true,
    status:              3,
    ai_services_enabled: true,
    time_mode:           "hard",
    finishedAt:          "2026-11-02T19:00:00.000Z",
    participantCount:    18,
    caseId:              31,
    caseTitle:           "Datos de pacientes",
});

let rows = [];
const db = installFakePgPool((sql) => (sql === TEACHER_ACTIVITIES_SQL ? rows : []));

// The teacher controller imports the Redis-backed descriptor cache, whose
// client starts connecting on import. No test here reaches Redis.
after(() => {
    db.restore();
    redisClient.disconnect();
});

beforeEach(() => {
    db.reset();
    rows = [NOT_STARTED_ROW, FINISHED_ROW];
});

function getActivities(session = TEACHER) {
    return requestRouter(activitiesTeacherRouter, { method: "GET", path: "/activities", session });
}

describe("GET /activities (#1049)", () => {
    it("lists the teacher's activities with one statement", async () => {
        const { status, body } = await getActivities();

        assert.equal(status, 200);
        assert.equal(body.status, "ok");
        assert.equal(db.queries.length, 1);
        assert.equal(db.queries[0].sql, TEACHER_ACTIVITIES_SQL);
        assert.deepEqual(db.queries[0].params, [TEACHER.uid]);
    });

    it("returns each row with the list's fields, in the statement's order", async () => {
        const { body } = await getActivities();

        assert.deepEqual(body.activities.map(activity => activity.sessionId), [43, 42]);
        assert.deepEqual(body.activities[0], {
            id:                12,
            sessionId:         43,
            creator:           5,
            name:              "Privacy",
            description:       "Section 4",
            time:              "2026-11-03T09:00:00.000Z",
            code:              "DEF456",
            archived:          false,
            status:            1,
            type:              "T",
            designId:          7,
            designTitle:       "Privacy",
            currentPhase:      null,
            phaseCount:        2,
            participantCount:  0,
            aiServicesEnabled: false,
            timeMode:          "none",
            finishedAt:        null,
            caseId:            null,
            caseTitle:         null,
        });
        assert.equal(body.activities[1].caseId, 31);
        assert.equal(body.activities[1].caseTitle, "Datos de pacientes");
        assert.equal(body.activities[1].finishedAt, "2026-11-02T19:00:00.000Z");
        assert.equal(body.activities[1].participantCount, 18);
        assert.equal(body.activities[1].aiServicesEnabled, true);
        assert.equal(body.activities[1].timeMode, "hard");
    });

    it("does not return the design documents (#1055)", async () => {
        const { body } = await getActivities();

        for (const activity of body.activities) {
            assert.equal(Object.hasOwn(activity, "design"), false);
        }
        assert.doesNotMatch(JSON.stringify(body), /"phases"/u);
    });

    it("answers an empty list for a teacher with no activities", async () => {
        rows = [];
        const { status, body } = await getActivities();

        assert.equal(status, 200);
        assert.deepEqual(body, { status: "ok", activities: [] });
    });

    it("refuses a student without querying", async () => {
        const { status } = await getActivities({ uid: 9, role: "A" });

        assert.notEqual(status, 200);
        assert.equal(db.queries.length, 0);
    });
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

import {
    createActivityTutorModesRouter,
    listActivityTutorModesForOwner,
} from "../activity-tutor-modes.js";
import { listSessionTutorModes, toTutorModeRecords } from "../../helpers/tutor-mode-records.js";

const OWNER_ID = 3;
const OTHER_TEACHER_ID = 99;

const RECORD = Object.freeze({
    phaseId:         20,
    phaseNumber:     2,
    questionId:      101,
    questionKey:     "p2-q1",
    questionNumber:  1,
    tutorMode:       "basic",
    tutorModeReason: "no-inventory",
    createdAt:       "2026-10-27T10:00:00.000Z",
    evaluations:     { enhanced: 0, basic: 0, unreported: 2 },
});

function makeDependencies() {
    const calls = { ownsSession: [], listTutorModes: [] };
    return {
        calls,
        dependencies: {
            ownsSession: async (sessionId, userId) => {
                calls.ownsSession.push({ sessionId, userId });
                return userId === OWNER_ID;
            },
            listTutorModes: async (sessionId) => {
                calls.listTutorModes.push(sessionId);
                return [RECORD];
            },
        },
    };
}

// ─── toTutorModeRecords ──────────────────────────────────────────────────────

test("toTutorModeRecords: one record per tutor session, with its evaluations by mode", () => {
    const records = toTutorModeRecords([
        {
            phase_id:          20, phase_number:      2, question_id:       102, question_key:      "p2-q2",
            tutor_mode:        "enhanced", tutor_mode_reason: "ignored", created_at:        "t2",
        },
        {
            phase_id:          20, phase_number:      2, question_id:       101, question_key:      "p2-q1",
            tutor_mode:        "basic", tutor_mode_reason: "typology-pending", created_at:        "t1",
        },
        {
            phase_id:          10, phase_number:      1, question_id:       null, question_key:      "phase",
            tutor_mode:        "basic", tutor_mode_reason: null, created_at:        "t0",
        },
        { phase_id: 20, phase_number: 2, question_id: 103, question_key: "p2-q3", tutor_mode: "other" },
    ], [
        { phase_id: 20, question_id: 102, tutor_mode: "enhanced", evaluations: 3 },
        { phase_id: 20, question_id: 102, tutor_mode: null, evaluations: 1 },
        { phase_id: 20, question_id: 101, tutor_mode: null, evaluations: 2 },
    ]);

    assert.deepEqual(records.map(record => record.questionKey), ["phase", "p2-q1", "p2-q2"],
        "by phase and question number; unknown modes are left out");
    assert.deepEqual(records[1], {
        phaseId:         20,
        phaseNumber:     2,
        questionId:      101,
        questionKey:     "p2-q1",
        questionNumber:  1,
        tutorMode:       "basic",
        tutorModeReason: "typology-pending",
        createdAt:       "t1",
        evaluations:     { enhanced: 0, basic: 0, unreported: 2 },
    });
    assert.equal(records[2].tutorModeReason, null, "an enhanced session has no reason");
    assert.deepEqual(records[2].evaluations, { enhanced: 3, basic: 0, unreported: 1 });
    assert.equal(records[0].questionNumber, null);
    assert.deepEqual(records[0].evaluations, { enhanced: 0, basic: 0, unreported: 0 });
});

test("listSessionTutorModes: reads the latest report per phase and question, and the evaluations", async () => {
    const queries = [];
    const query = async ({ sql, sqlParams }) => {
        queries.push({ sql, sqlParams });
        return /external_service_jobs/u.test(sql)
            ? [{ phase_id: 20, phase_number: 2, question_id: 101, question_key: "p2-q1", tutor_mode: "enhanced" }]
            : [];
    };

    const records = await listSessionTutorModes(7, query);

    assert.equal(records.length, 1);
    assert.equal(records[0].tutorMode, "enhanced");
    assert.equal(queries.length, 2);
    for (const { sqlParams } of queries) {
        assert.deepEqual(sqlParams, [7, "argumentation-tutor-system"]);
    }
    assert.match(queries[0].sql, /DISTINCT ON \(j\.phase_id, j\.instantiation_report->>'questionKey'\)/u);
    assert.match(queries[0].sql, /ORDER BY j\.phase_id, j\.instantiation_report->>'questionKey', j\.created_at DESC/u);
    assert.match(queries[1].sql, /adapter_result->'payload'->>'tutorMode'/u);
});

// ─── listActivityTutorModesForOwner ──────────────────────────────────────────

test("listActivityTutorModesForOwner: the owner gets the activity's tutor sessions", async () => {
    const { dependencies, calls } = makeDependencies();

    const { status, body } = await listActivityTutorModesForOwner({
        sessionId: 7,
        userId:    OWNER_ID,
        dependencies,
    });

    assert.equal(status, 200);
    assert.deepEqual(body, { status: "ok", result: { sessionId: 7, questions: [RECORD] } });
    assert.deepEqual(calls.ownsSession, [{ sessionId: 7, userId: OWNER_ID }]);
});

test("listActivityTutorModesForOwner: another teacher gets 404 and nothing is read", async () => {
    const { dependencies, calls } = makeDependencies();

    const { status, body } = await listActivityTutorModesForOwner({
        sessionId: 7,
        userId:    OTHER_TEACHER_ID,
        dependencies,
    });

    assert.equal(status, 404);
    assert.equal(body.code, "SESSION_NOT_FOUND");
    assert.deepEqual(calls.listTutorModes, []);
});

// ─── routes ──────────────────────────────────────────────────────────────────

async function serve(router, { role, uid = OWNER_ID }) {
    const app = express();
    app.use((req, res, next) => {
        req.session = { uid, role };
        next();
    });
    app.use(router);

    const server = createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    return {
        async get(path) {
            const response = await fetch(`${baseUrl}${path}`);
            return { status: response.status, body: await response.json() };
        },
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

test("routes: students get 403, invalid ids 400, the owner 200", async () => {
    const { dependencies, calls } = makeDependencies();
    const router = createActivityTutorModesRouter(dependencies);
    const student = await serve(router, { role: "A" });
    const owner = await serve(router, { role: "P" });
    try {
        assert.equal((await student.get("/activities/7/tutor-modes")).status, 403);
        assert.equal((await owner.get("/activities/abc/tutor-modes")).status, 400);
        assert.equal((await owner.get("/activities/0/tutor-modes")).status, 400);
        assert.deepEqual(calls.ownsSession, [], "no lookup before the checks pass");

        const { status, body } = await owner.get("/activities/7/tutor-modes");
        assert.equal(status, 200);
        assert.deepEqual(body.result.questions, [RECORD]);
    } finally {
        await student.close();
        await owner.close();
    }
});

test("routes: a failed read answers 500", async () => {
    const router = createActivityTutorModesRouter({
        ownsSession:    async () => true,
        listTutorModes: async () => { throw new Error("db down"); },
    });
    const owner = await serve(router, { role: "P" });
    const originalError = console.error;
    console.error = () => {};
    try {
        assert.equal((await owner.get("/activities/7/tutor-modes")).status, 500);
    } finally {
        console.error = originalError;
        await owner.close();
    }
});

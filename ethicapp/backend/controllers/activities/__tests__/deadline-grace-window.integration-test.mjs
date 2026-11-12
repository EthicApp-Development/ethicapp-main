// Integration tests for the grace window after an automatic advance (#1114,
// epic #1105), against a real PostgreSQL database with migrations V1-V45
// applied. POST /activities/:id/response runs with its real policy SQL and
// response writes, on hard-mode activities whose phases the real phase
// starter starts, by the teacher or by the deadline (an `ends_at` moved into
// the past stands in for the deadline runner, #1113). The window is measured
// by the database's clock, which fakes cannot check.
//
// Covered: an answer to the previous phase within 15 s of a deadline advance
// is stored against that phase; after 15 s, after a teacher's advance, to an
// older phase and to another session's phase it is refused with
// PHASE_CHANGED and nothing is written. The group's view of earlier answers
// (getCachedPreviousGroupResponses) shows the late answer and is not cached
// inside the window, and is cached once it closes; the suite replaces
// Redis's get and set with an in-memory map.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert users, designs, sessions, phases
// and responses of their own, which are not removed.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import pg from "pg";

import { requestRouter } from "../../__tests__/fake-pg-pool.mjs";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

if (SKIP_REASON) {
    console.warn(SKIP_REASON);
}

let pool = null;
const query = async (sql, params = []) => (await pool.query(sql, params)).rows;

// Loaded in before(): the application's database settings are read when its
// modules are imported, so DATABASE_URL must be set first.
let app = null;

async function loadApplication() {
    process.env.DATABASE_URL = DATABASE_URL;
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

    const [
        { default: router, responseSubmissionEffects },
        { getCachedPreviousGroupResponses },
        { createPhaseStarter },
        { DEADLINE_GRACE_WINDOW_SECONDS },
        { default: redisClient },
        config,
        rpg2,
    ] = await Promise.all([
        import("../activities-student.js"),
        import("../../../helpers/student-activity-state-helper.js"),
        import("../../../helpers/phase-start-helper.js"),
        import("../../../helpers/student-response-policy.js"),
        import("../../../db/redis.js"),
        import("../../../config/database.config.js"),
        import("../../../db/rest-pg-2.js"),
    ]);
    // The cache is an in-memory map installed per test; no Redis is reached.
    redisClient.disconnect();

    const starter = createPhaseStarter({
        connect:                     () => pool.connect(),
        invalidateStudentPhaseState: async () => {},
        notifyPhaseStarted:          async () => {},
        dispatchPhaseHook:           async () => {},
        logger:                      { warn() {}, error() {} },
    });

    return {
        router,
        responseSubmissionEffects,
        getCachedPreviousGroupResponses,
        starter,
        windowSeconds: DEADLINE_GRACE_WINDOW_SECONDS,
        redisClient,
        async close() {
            await (await rpg2.getDBInstance(config.dbconnString)).end();
            await pool.end();
        },
    };
}

function question(text) {
    return {
        q_text:     text,
        ans_format: {
            l_pole:          "Left",
            r_pole:          "Right",
            values:          7,
            just_required:   false,
            min_just_length: 0,
        },
    };
}

// Three five-minute phases; the second is a team phase of two that shows the
// group's answers to the first.
const DESIGN = {
    type:   "semantic_differential",
    phases: [
        {
            mode:               "individual",
            durationMinutes:    5,
            prevPhasesResponse: [],
            questions:          [question("One")],
        },
        {
            mode:               "team",
            durationMinutes:    5,
            grouping_algorithm: "random",
            stdntAmount:        2,
            prevPhasesResponse: [1],
            questions:          [question("Two")],
        },
        {
            mode:               "individual",
            durationMinutes:    5,
            prevPhasesResponse: [],
            questions:          [question("Three")],
        },
    ],
};

const RANKING_DESIGN = {
    type:   "ranking",
    phases: [1, 2].map(number => ({
        mode:               "individual",
        durationMinutes:    5,
        q_text:             `Rank them ${number}`,
        prevPhasesResponse: [],
        roles:              [{ name: "First", type: null, wc: 0 }],
    })),
};

async function createUser(role) {
    const [user] = await query(`
        INSERT INTO users (name, mail, role)
        VALUES ('Integration user', $1, $2)
        RETURNING id;
    `, [`${randomUUID()}@integration.test`, role]);
    return { uid: Number(user.id), role };
}

// A launched hard-mode activity with `students` enrolled and no phase yet.
async function createActivity(teacher, students, design = DESIGN) {
    const [{ id: sessionId }] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type, time_mode)
        VALUES ('Integration session', '', $1, now(), 1, 'T', 'hard')
        RETURNING id;
    `, [teacher.uid]);
    const [{ id: designId }] = await query(
        "INSERT INTO designs (creator, design, locked) VALUES ($1, $2, true) RETURNING id;",
        [teacher.uid, design]
    );
    await query("INSERT INTO activity (design, session) VALUES ($1, $2);", [designId, sessionId]);
    for (const student of students) {
        await query("INSERT INTO sesusers (sesid, uid) VALUES ($1, $2);", [sessionId, student.uid]);
    }
    return { sessionId: Number(sessionId), teacherId: teacher.uid, phases: [] };
}

async function phaseItems(phaseId) {
    const differential = await query(
        "SELECT id FROM differential WHERE stageid = $1 ORDER BY orden;", [phaseId]);
    const actors = await query("SELECT id FROM actors WHERE stageid = $1 ORDER BY id;", [phaseId]);
    return { questionId: Number(differential[0]?.id), itemId: Number(actors[0]?.id) };
}

// Starts the activity's next phase, by the teacher or, once the current
// phase's deadline is moved into the past, by the deadline.
async function advance(activity, trigger) {
    const current = activity.phases.at(-1);
    if (trigger === "deadline") {
        await query("UPDATE stages SET ends_at = now() - interval '1 second' WHERE id = $1;",
            [current.id]);
    }
    const result = await app.starter.startNextPhase({
        sessionId:           activity.sessionId,
        teacherId:           activity.teacherId,
        expectedPhaseNumber: activity.phases.length,
        trigger,
    });
    assert.equal(result.status, "started");
    const phase = { id: result.phase.id, ...await phaseItems(result.phase.id) };
    activity.phases.push(phase);
    return phase;
}

// Moves the start of phase `phaseId` `seconds` into the past.
async function startedSecondsAgo(phaseId, seconds) {
    await query(`
        UPDATE stages
        SET started_at = now() - $2::integer * interval '1 second'
        WHERE id = $1;
    `, [phaseId, seconds]);
}

function submit(student, sessionId, body) {
    return requestRouter(app.router, {
        method:  "POST",
        path:    `/activities/${sessionId}/response`,
        body,
        session: student,
    });
}

function answer(phase, value = 4) {
    return { phaseId: phase.id, questionId: phase.questionId, value };
}

async function storedAnswers(userId, questionId) {
    return query(
        "SELECT sel FROM differential_selection WHERE uid = $1 AND did = $2 ORDER BY id;",
        [userId, questionId]
    );
}

describe("POST /activities/:id/response after an automatic advance (#1114)", {
    skip: SKIP_REASON,
}, () => {
    let teacher;
    let student;
    let peer;
    let outsider;
    let notifyTeacher;
    let dispatchHook;

    before(async () => {
        app = await loadApplication();
        teacher = await createUser("P");
        student = await createUser("A");
        peer = await createUser("A");
        outsider = await createUser("A");
    });

    after(async () => {
        await app?.close();
    });

    beforeEach(() => {
        notifyTeacher = mock.method(app.responseSubmissionEffects, "notifyTeacher", () => {});
        dispatchHook = mock.method(app.responseSubmissionEffects, "dispatchHook", async () => {});
    });

    afterEach(() => {
        mock.restoreAll();
    });

    async function assertRefused(response, code = "PHASE_CHANGED", status = 409) {
        assert.equal(response.status, status);
        assert.equal(response.body.code, code);
        assert.equal(notifyTeacher.mock.callCount(), 0);
        assert.equal(dispatchHook.mock.callCount(), 0);
    }

    it("stores an answer to the previous phase within the window, against that phase", async () => {
        const activity = await createActivity(teacher, [student, peer]);
        const first = await advance(activity, "teacher");
        const second = await advance(activity, "deadline");

        const [stage] = await query(
            "SELECT start_trigger FROM stages WHERE id = $1;", [second.id]);
        assert.equal(stage.start_trigger, "deadline");

        const response = await submit(student, activity.sessionId, answer(first, 5));

        assert.equal(response.status, 201);
        assert.deepEqual(await storedAnswers(student.uid, first.questionId), [{ sel: 5 }]);
        const [{ stageid }] = await query("SELECT stageid FROM differential WHERE id = $1;",
            [first.questionId]);
        assert.equal(Number(stageid), first.id);
        const [notifiedSession, notifiedPhase] = notifyTeacher.mock.calls[0].arguments;
        assert.deepEqual([notifiedSession, notifiedPhase], [activity.sessionId, first.id]);
        assert.equal(dispatchHook.mock.callCount(), 0);

        // An answer sent again in the window replaces the first one.
        const again = await submit(student, activity.sessionId, answer(first, 2));
        assert.equal(again.status, 201);
        assert.deepEqual(await storedAnswers(student.uid, first.questionId), [{ sel: 2 }]);

        // The current phase still takes answers, which dispatch the hook.
        const current = await submit(student, activity.sessionId, answer(second, 3));
        assert.equal(current.status, 201);
        assert.equal(dispatchHook.mock.callCount(), 1);
        assert.equal(dispatchHook.mock.calls[0].arguments[0].phaseId, second.id);
    });

    it("keeps the window open until 15 s after the advance, and refuses after", async () => {
        const activity = await createActivity(teacher, [student]);
        const first = await advance(activity, "teacher");
        const second = await advance(activity, "deadline");

        await startedSecondsAgo(second.id, app.windowSeconds - 2);
        const late = await submit(student, activity.sessionId, answer(first));
        assert.equal(late.status, 201);

        notifyTeacher.mock.resetCalls();
        await startedSecondsAgo(second.id, app.windowSeconds);
        await assertRefused(await submit(student, activity.sessionId, answer(first, 6)));
        assert.deepEqual(await storedAnswers(student.uid, first.questionId), [{ sel: 4 }]);
    });

    it("refuses the previous phase after a teacher's advance", async () => {
        const activity = await createActivity(teacher, [student]);
        const first = await advance(activity, "teacher");
        await advance(activity, "teacher");

        await assertRefused(await submit(student, activity.sessionId, answer(first)));
        assert.deepEqual(await storedAnswers(student.uid, first.questionId), []);
    });

    it("refuses an older phase, and another session's phase, within the window", async () => {
        const activity = await createActivity(teacher, [student, peer]);
        const first = await advance(activity, "teacher");
        const second = await advance(activity, "deadline");
        const third = await advance(activity, "deadline");

        // Another activity of the same student, also just advanced by the
        // deadline: its previous phase is not this session's.
        const other = await createActivity(teacher, [student]);
        const otherFirst = await advance(other, "teacher");
        await advance(other, "deadline");

        await assertRefused(await submit(student, activity.sessionId, answer(first)));
        await assertRefused(await submit(student, activity.sessionId, answer(otherFirst)));
        assert.deepEqual(await storedAnswers(student.uid, first.questionId), []);
        assert.deepEqual(await storedAnswers(student.uid, otherFirst.questionId), []);

        // The phase just before the current one is still accepted.
        const response = await submit(student, activity.sessionId, answer(second));
        assert.equal(response.status, 201);
        assert.equal(notifyTeacher.mock.calls[0].arguments[1], second.id);
        assert.ok(third.id > second.id);
    });

    it("checks a late answer as a current one: enrollment, task and value", async () => {
        const activity = await createActivity(teacher, [student]);
        const first = await advance(activity, "teacher");
        const second = await advance(activity, "deadline");
        mock.method(console, "warn", () => {});

        // A student of another session.
        await assertRefused(await submit(outsider, activity.sessionId, answer(first)),
            "SESSION_NOT_FOUND", 404);
        // The current phase's question, sent as the previous phase's.
        await assertRefused(await submit(student, activity.sessionId, {
            phaseId: first.id, questionId: second.questionId, value: 3,
        }), "QUESTION_NOT_IN_PHASE", 400);
        // A value out of the question's range.
        const invalid = await submit(student, activity.sessionId, answer(first, 8));
        assert.equal(invalid.status, 400);
        assert.equal(notifyTeacher.mock.callCount(), 0);

        assert.deepEqual(await storedAnswers(outsider.uid, first.questionId), []);
        assert.deepEqual(await storedAnswers(student.uid, first.questionId), []);
        assert.deepEqual(await storedAnswers(student.uid, second.questionId), []);
    });

    it("refuses the previous phase once the activity is finished", async () => {
        const activity = await createActivity(teacher, [student]);
        const first = await advance(activity, "teacher");
        await advance(activity, "deadline");
        await query("UPDATE sessions SET status = 3, current_stage = NULL WHERE id = $1;",
            [activity.sessionId]);

        await assertRefused(await submit(student, activity.sessionId, answer(first)),
            "ACTIVITY_FINISHED");
    });

    it("stores a ranking answer with the previous phase's id", async () => {
        const activity = await createActivity(teacher, [student], RANKING_DESIGN);
        const first = await advance(activity, "teacher");
        await advance(activity, "deadline");

        // With a justification: actor_selection.description is NOT NULL.
        const response = await submit(student, activity.sessionId, {
            phaseId:       first.id,
            questionId:    first.itemId,
            itemId:        first.itemId,
            order:         1,
            justification: "Late but kept.",
        });

        assert.equal(response.status, 201);
        const rows = await query(
            "SELECT stageid, orden FROM actor_selection WHERE uid = $1 AND actorid = $2;",
            [student.uid, first.itemId]);
        assert.deepEqual(rows.map(row => [Number(row.stageid), row.orden]), [[first.id, 1]]);
        assert.equal(dispatchHook.mock.callCount(), 0);
    });

    it("does not cache the group's earlier answers in the window, and does after", async () => {
        const cache = new Map();
        mock.method(app.redisClient, "get", async key => cache.get(key) ?? null);
        mock.method(app.redisClient, "set", async (key, value) => {
            cache.set(key, value);
            return "OK";
        });

        const activity = await createActivity(teacher, [student, peer]);
        const first = await advance(activity, "teacher");
        const second = await advance(activity, "deadline");
        const groupAnswers = async () => {
            const view = await app.getCachedPreviousGroupResponses(second.id, peer.uid, [1]);
            return view.phases.flatMap(phase => phase.tasks.flatMap(task =>
                task.responses.map(response => response.userId)));
        };

        // The peer opens the team phase before the student's late answer.
        assert.deepEqual(await groupAnswers(), []);
        assert.equal(cache.size, 0);

        assert.equal((await submit(student, activity.sessionId, answer(first))).status, 201);
        assert.deepEqual(await groupAnswers(), [student.uid]);
        assert.equal(cache.size, 0);

        // Once the window closed, the view is cached again.
        await startedSecondsAgo(second.id, app.windowSeconds + 1);
        assert.deepEqual(await groupAnswers(), [student.uid]);
        assert.equal(cache.size, 1);
    });
});

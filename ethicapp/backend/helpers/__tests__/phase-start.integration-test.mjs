// Integration tests for starting an activity's next phase (#906), against a
// real PostgreSQL database with migrations V1-V45 applied: the transaction
// that creates the phase, its items and its groups and moves the session to
// it, its rollback, two concurrent starts of the same phase, the
// UNIQUE (sesid, number) constraint of V33, a start that waits for the
// forgetting of its teacher, and the phase clock of V45 (#1110): each phase's
// start, trigger and deadline from the database's clock, and the starts by
// the deadline. Lock waits, rollbacks and the database's clock cannot be
// checked with fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert users, designs, sessions and
// phases of their own, which are not removed.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import pg from "pg";

import { createPhaseStarter, LOCK_SESSION_SQL, LOCK_TEACHER_SQL } from "../phase-start-helper.js";
import { INSERT_TEAM_MEMBERS_SQL } from "../groups-helper.js";
import { TRANSITION_SESSION_SQL } from "../teacher-activity-writes.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

const INITIATED = 1;
const IN_PROGRESS = 2;
const FINISHED = 3;

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
    return pool;
}

async function query(sql, params = []) {
    return (await getPool().query(sql, params)).rows;
}

test.after(async () => {
    await pool?.end();
});

function question(text, contentType) {
    return {
        q_text:              text,
        q_text_content_type: contentType,
        ans_format:          {
            l_pole:          "Left",
            r_pole:          "Right",
            values:          7,
            just_required:   true,
            min_just_length: 5,
        },
    };
}

// The three kinds of phase of the live check: individual, anonymous team, and
// identified team with chat that keeps the groups.
const SD_DESIGN = {
    type:   "semantic_differential",
    phases: [
        {
            mode:               "individual",
            anonymous:          true,
            chat:               false,
            grouping_algorithm: "random",
            stdntAmount:        3,
            prevPhasesResponse: [],
            questions:          [
                question("One", "text/plain"),
                question("**Two**", "text/markdown"),
            ],
        },
        {
            mode:               "team",
            anonymous:          true,
            chat:               false,
            grouping_algorithm: "random",
            stdntAmount:        2,
            prevPhasesResponse: [1],
            questions:          [question("Three")],
        },
        {
            mode:               "team",
            anonymous:          false,
            chat:               true,
            grouping_algorithm: "preserve",
            stdntAmount:        2,
            prevPhasesResponse: [1, 2],
            questions:          [question("Four")],
        },
    ],
};

const RANKING_DESIGN = {
    type:   "ranking",
    phases: [{
        mode:               "individual",
        anonymous:          false,
        chat:               false,
        q_text:             "Rank them",
        prevPhasesResponse: [],
        roles:              [
            { name: "First", type: "order", wc: 10 },
            { name: "Second", type: null, wc: 0 },
        ],
    }],
};

async function insertUser(role) {
    const suffix = randomUUID();
    const [user] = await query(`
        INSERT INTO users (name, mail, role)
        VALUES ('Integration user', $1, $2)
        RETURNING id;
    `, [`${suffix}@integration.test`, role]);
    return Number(user.id);
}

// A launched activity of `design`, with `studentCount` students in it.
async function createActivity({
    design = SD_DESIGN,
    studentCount = 5,
    status = INITIATED,
    timeMode = "none",
} = {}) {
    const teacherId = await insertUser("P");
    const [{ id: designId }] = await query(
        "INSERT INTO designs (creator, design, locked) VALUES ($1, $2, true) RETURNING id;",
        [teacherId, design]
    );
    const [{ id: sessionId }] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type, time_mode)
        VALUES ('Integration session', '', $1, now(), $2, 'T', $3)
        RETURNING id;
    `, [teacherId, status, timeMode]);
    await query("INSERT INTO activity (design, session) VALUES ($1, $2);", [designId, sessionId]);
    await query("INSERT INTO sesusers (sesid, uid) VALUES ($1, $2);", [sessionId, teacherId]);

    const studentIds = [];
    for (let i = 0; i < studentCount; i += 1) {
        const studentId = await insertUser("A");
        await query("INSERT INTO sesusers (sesid, uid) VALUES ($1, $2);", [sessionId, studentId]);
        studentIds.push(studentId);
    }
    return { teacherId, sessionId: Number(sessionId), studentIds };
}

/**
 * A starter on the test database. `failOn` makes the statement with that SQL
 * throw, after the ones before it ran in the transaction; `onConnect` sees
 * each checked-out client. `transactionTimes` receives, as text, the
 * database's now() inside each transaction the starter opens.
 */
function makeStarter({
    failOn = null,
    onConnect = async () => {},
    transactionTimes = null,
} = {}) {
    const effects = [];
    const starter = createPhaseStarter({
        connect: async () => {
            const client = await getPool().connect();
            await onConnect(client);
            if (!failOn && !transactionTimes) {
                return client;
            }
            return {
                query: async (sql, params) => {
                    if (sql === failOn) {
                        throw new Error("Forced failure");
                    }
                    const result = await client.query(sql, params);
                    if (sql === "BEGIN" && transactionTimes) {
                        const { rows: [row] } = await client.query("SELECT now()::text AS now;");
                        transactionTimes.push(row.now);
                    }
                    return result;
                },
                release: () => client.release(),
            };
        },
        invalidateStudentDescriptor: async (sessionId) => {
            effects.push(["invalidate", sessionId]);
        },
        notifyPhaseStarted: async (sessionId) => {
            effects.push(["notify", sessionId]);
        },
        dispatchPhaseHook: async (hookName, context) => {
            effects.push([hookName, context.phaseId]);
        },
        logger: { warn() {}, error() {} },
    });
    return { starter, effects };
}

async function phasesOf(sessionId) {
    return query(`
        SELECT id, number, type, anon, chat, prev_ans, question, grouping
        FROM stages
        WHERE sesid = $1
        ORDER BY number, id;
    `, [sessionId]);
}

async function sessionOf(sessionId) {
    const [row] = await query(
        "SELECT status, current_stage FROM sessions WHERE id = $1;",
        [sessionId]
    );
    return {
        status:       Number(row.status),
        currentStage: row.current_stage === null ? null : Number(row.current_stage),
    };
}

// Each team of the phase: its members' ids in letter order, and their letters.
async function groupsOf(phaseId) {
    const rows = await query(`
        SELECT t.id AS team_id,
               array_agg(tu.uid ORDER BY tu.anon_mask) AS members,
               array_agg(tu.anon_mask ORDER BY tu.anon_mask) AS masks
        FROM teams AS t
        INNER JOIN teamusers AS tu ON tu.tmid = t.id
        WHERE t.stageid = $1
        GROUP BY t.id
        ORDER BY t.id;
    `, [phaseId]);
    return rows.map(row => ({
        members: row.members.map(Number),
        masks:   row.masks.map(mask => mask.trim()),
    }));
}

async function countRows(sessionId) {
    const [row] = await query(`
        SELECT (SELECT count(*) FROM stages WHERE sesid = $1)::integer AS stages,
               (SELECT count(*) FROM differential WHERE sesid = $1)::integer AS differential,
               (SELECT count(*) FROM actors AS a INNER JOIN stages AS st ON a.stageid = st.id
                WHERE st.sesid = $1)::integer AS actors,
               (SELECT count(*) FROM teams WHERE sesid = $1)::integer AS teams,
               (SELECT count(*) FROM teamusers AS tu INNER JOIN teams AS t ON tu.tmid = t.id
                WHERE t.sesid = $1)::integer AS teamusers;
    `, [sessionId]);
    return row;
}

async function waitUntilBlockedOnLock(pid) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const [row] = await query(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1;",
            [pid]
        );
        if (row?.wait_event_type === "Lock") {
            return;
        }
        await delay(50);
    }
    throw new Error(`Backend ${pid} never waited on a lock.`);
}

// Records the backend pid of each client the starter checks out.
function recordPid(pids) {
    return async (client) => {
        const { rows: [{ pid }] } = await client.query("SELECT pg_backend_pid() AS pid;");
        pids.push(pid);
    };
}

test("an activity's phases start one by one from its design, with items, groups and letters", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId, studentIds } = await createActivity();
    const { starter, effects } = makeStarter();
    const start = expectedPhaseNumber =>
        starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber });

    // Phase 1: individual, with both questions in order.
    const first = await start(0);
    await first.hooks;
    assert.equal(first.status, "started");
    assert.equal(first.phase.number, 1);
    assert.deepEqual(await sessionOf(sessionId),
        { status: IN_PROGRESS, currentStage: first.phase.id });
    const items = await query(`
        SELECT title, title_content_type, tleft, tright, orden, num, justify, word_count, creator
        FROM differential
        WHERE stageid = $1
        ORDER BY id;
    `, [first.phase.id]);
    assert.deepEqual(items.map(item => [item.title, item.title_content_type, item.orden]),
        [["One", "text/plain", 1], ["**Two**", "text/markdown", 2]]);
    assert.deepEqual(
        items.map(item => [item.num, item.justify, item.word_count, Number(item.creator)]),
        [[7, true, 5, teacherId], [7, true, 5, teacherId]]
    );
    assert.deepEqual(await groupsOf(first.phase.id), []);
    assert.deepEqual(effects.splice(0), [
        ["invalidate", sessionId],
        ["notify", sessionId],
        ["phase-started", first.phase.id],
        ["activity-started", first.phase.id],
    ]);

    // Phase 2: anonymous team, random groups of two; the fifth student joins
    // the first group.
    const second = await start(1);
    await second.hooks;
    assert.equal(second.phase.number, 2);
    const randomGroups = await groupsOf(second.phase.id);
    assert.deepEqual(randomGroups.map(group => group.masks), [["A", "B", "C"], ["A", "B"]]);
    assert.deepEqual(randomGroups.flatMap(group => group.members).sort(), [...studentIds].sort());
    assert.deepEqual(effects.splice(0), [
        ["invalidate", sessionId],
        ["notify", sessionId],
        ["phase-ended", first.phase.id],
        ["phase-started", second.phase.id],
    ]);

    // Phase 3: identified team with chat, keeping phase 2's groups.
    const third = await start(2);
    assert.equal(third.phase.number, 3);
    const preserved = await groupsOf(third.phase.id);
    assert.deepEqual(preserved, randomGroups);

    const columns = phase => [phase.number, phase.type, phase.anon, phase.chat, phase.prev_ans,
        phase.question, phase.grouping];
    assert.deepEqual((await phasesOf(sessionId)).map(columns), [
        [1, "individual", true, false, "[]", null, null],
        [2, "team", true, false, "[1]", null, "2:random"],
        [3, "team", false, true, "[1,2]", null, "2:preserve"],
    ]);
    assert.deepEqual(await sessionOf(sessionId),
        { status: IN_PROGRESS, currentStage: third.phase.id });

    // There is no fourth phase.
    assert.deepEqual(await start(3), { status: "no_next_phase", currentPhaseNumber: 3 });
});

test("a ranking phase starts with its roles", { skip: SKIP_REASON }, async () => {
    const { teacherId, sessionId } = await createActivity({
        design:       RANKING_DESIGN,
        studentCount: 0,
    });
    const { starter } = makeStarter();

    const result = await starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber: 0 });

    assert.equal(result.status, "started");
    const roles = await query(
        "SELECT name, jorder, justified, word_count FROM actors WHERE stageid = $1 ORDER BY id;",
        [result.phase.id]
    );
    assert.deepEqual(roles, [
        { name: "First", jorder: true, justified: true, word_count: 10 },
        { name: "Second", jorder: false, justified: false, word_count: 0 },
    ]);
    assert.equal((await phasesOf(sessionId))[0].question, "Rank them");
});

test("a failure after the items and groups leaves no phase, item or group, nor a moved session", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId } = await createActivity();
    await makeStarter().starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber: 0 });
    const before = await countRows(sessionId);
    const sessionBefore = await sessionOf(sessionId);

    for (const failOn of [INSERT_TEAM_MEMBERS_SQL, TRANSITION_SESSION_SQL]) {
        const { starter, effects } = makeStarter({ failOn });
        await assert.rejects(
            starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber: 1 }),
            /Forced failure/u
        );
        assert.deepEqual(await countRows(sessionId), before);
        assert.deepEqual(await sessionOf(sessionId), sessionBefore);
        assert.deepEqual(effects, [], "nothing is announced");
    }

    // The retry starts the phase once.
    const retry = await makeStarter().starter.startNextPhase({
        sessionId,
        teacherId,
        expectedPhaseNumber: 1,
    });
    assert.equal(retry.status, "started");
    assert.deepEqual((await phasesOf(sessionId)).map(phase => phase.number), [1, 2]);
});

test("of two concurrent starts of a phase, one starts it, the other learns the activity moved", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId } = await createActivity();
    const pids = [];
    const { starter } = makeStarter({ onConnect: recordPid(pids) });

    // Both requests wait for the session's lock, held here, so they overlap.
    const blocker = await getPool().connect();
    try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM sessions WHERE id = $1 FOR UPDATE;", [sessionId]);

        const requests = [0, 0].map(expectedPhaseNumber =>
            starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber }));
        while (pids.length < 2) {
            await delay(20);
        }
        await Promise.all(pids.map(waitUntilBlockedOnLock));
        await blocker.query("COMMIT");

        const results = await Promise.all(requests);
        const statuses = results.map(result => result.status).sort();
        assert.deepEqual(statuses, ["stale", "started"]);
        assert.deepEqual(results.find(result => result.status === "stale"),
            { status: "stale", currentPhaseNumber: 1 });
    } finally {
        blocker.release();
    }

    const phases = await phasesOf(sessionId);
    assert.deepEqual(phases.map(phase => phase.number), [1]);
    assert.equal((await countRows(sessionId)).differential, 2);
    assert.deepEqual(await sessionOf(sessionId),
        { status: IN_PROGRESS, currentStage: Number(phases[0].id) });
});

test("V33 refuses a second phase with a number its session already has", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId } = await createActivity();
    await makeStarter().starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber: 0 });

    const insertPhaseOne = "INSERT INTO stages (number, type, sesid) VALUES (1, 'individual', $1);";
    await assert.rejects(
        query(insertPhaseOne, [sessionId]),
        error => error.code === "23505" && error.constraint === "stages_sesid_number_key"
    );
    // Another session may use the number.
    const other = await createActivity();
    await query(insertPhaseOne, [other.sessionId]);
});

test("a phase left by a start that failed before the transaction is replaced", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId } = await createActivity();
    const [{ id: leftoverId }] = await query(
        "INSERT INTO stages (number, type, sesid) VALUES (1, 'team', $1) RETURNING id;",
        [sessionId]
    );
    await query(`
        INSERT INTO differential (tleft, tright, orden, stageid, sesid)
        VALUES ('l', 'r', 1, $1, $2);
    `, [leftoverId, sessionId]);
    const [{ id: teamId }] = await query(
        "INSERT INTO teams (sesid, stageid) VALUES ($1, $2) RETURNING id;",
        [sessionId, leftoverId]
    );
    const [{ uid: studentId }] = await query(
        "SELECT uid FROM sesusers WHERE sesid = $1 AND uid <> $2 LIMIT 1;",
        [sessionId, teacherId]
    );
    await query(
        "INSERT INTO teamusers (tmid, uid, anon_mask) VALUES ($1, $2, 'A');",
        [teamId, studentId]
    );

    const result = await makeStarter().starter.startNextPhase({
        sessionId,
        teacherId,
        expectedPhaseNumber: 0,
    });

    assert.equal(result.status, "started");
    const phases = await phasesOf(sessionId);
    assert.deepEqual(phases.map(phase => [Number(phase.id), phase.number]), [[result.phase.id, 1]]);
    assert.deepEqual(await countRows(sessionId),
        { stages: 1, differential: 2, actors: 0, teams: 0, teamusers: 0 });
});

test("only the session's teacher, not anonymized, starts a phase of an open activity", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId } = await createActivity();
    const otherTeacherId = await insertUser("P");
    const { starter } = makeStarter();

    const start = request => starter.startNextPhase({ expectedPhaseNumber: 0, ...request });

    assert.deepEqual(await start({ sessionId, teacherId: otherTeacherId }),
        { status: "forbidden" });
    assert.deepEqual(await start({ sessionId: 2147483647, teacherId }), { status: "not_found" });

    const finished = await createActivity({ status: FINISHED });
    assert.deepEqual(await starter.startNextPhase({
        sessionId: finished.sessionId, teacherId: finished.teacherId, expectedPhaseNumber: 0,
    }), { status: "finished" });

    await query("UPDATE users SET anonymized_at = now() WHERE id = $1;", [teacherId]);
    assert.deepEqual(await starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber: 0 }),
        { status: "forbidden" });
    assert.equal((await countRows(sessionId)).stages, 0);
});

test("a start requested while the teacher is being forgotten waits and writes nothing", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId } = await createActivity();
    const pids = [];
    const { starter, effects } = makeStarter({ onConnect: recordPid(pids) });

    // The console's forgetting holds the account FOR UPDATE until it commits.
    const forgetting = await getPool().connect();
    try {
        await forgetting.query("BEGIN");
        await forgetting.query("SELECT id FROM users WHERE id = $1 FOR UPDATE;", [teacherId]);

        const request = starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber: 0 });
        while (pids.length < 1) {
            await delay(20);
        }
        await waitUntilBlockedOnLock(pids[0]);
        const [waiting] = await query(
            "SELECT query FROM pg_stat_activity WHERE pid = $1;",
            [pids[0]]
        );
        assert.equal(waiting.query, LOCK_TEACHER_SQL, "it waits on the account first");

        await forgetting.query(
            "UPDATE users SET anonymized_at = now(), active = false WHERE id = $1;",
            [teacherId]
        );
        await forgetting.query("COMMIT");

        assert.deepEqual(await request, { status: "forbidden" });
    } finally {
        forgetting.release();
    }

    assert.deepEqual(await countRows(sessionId),
        { stages: 0, differential: 0, actors: 0, teams: 0, teamusers: 0 });
    assert.deepEqual(await sessionOf(sessionId), { status: INITIATED, currentStage: null });
    assert.deepEqual(effects, []);
});

test("a finish committed while a start waits for the session is seen by the start", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId } = await createActivity();
    const pids = [];
    const { starter } = makeStarter({ onConnect: recordPid(pids) });

    const finishing = await getPool().connect();
    try {
        await finishing.query("BEGIN");
        await finishing.query(LOCK_SESSION_SQL, [sessionId]);

        const request = starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber: 0 });
        while (pids.length < 1) {
            await delay(20);
        }
        await waitUntilBlockedOnLock(pids[0]);
        await finishing.query(
            "UPDATE sessions SET status = $1, current_stage = NULL WHERE id = $2;",
            [FINISHED, sessionId]
        );
        await finishing.query("COMMIT");

        assert.deepEqual(await request, { status: "finished" });
    } finally {
        finishing.release();
    }
    assert.equal((await countRows(sessionId)).stages, 0);
});

// --- Phase clock (V45, #1110) -------------------------------------------------

// Two individual phases of 5 and 10 minutes, then one without a duration.
const TIMED_DESIGN = {
    type:   "semantic_differential",
    phases: [
        { ...SD_DESIGN.phases[0], durationMinutes: 5 },
        { ...SD_DESIGN.phases[0], durationMinutes: 10 },
        { ...SD_DESIGN.phases[0] },
    ],
};

// The clock columns of a phase, with what the database computes from them.
async function clockOf(phaseId) {
    const [row] = await query(`
        SELECT started_at::text AS started_at,
               ends_at::text AS ends_at,
               duration_seconds,
               start_trigger,
               deadline_handled_at::text AS deadline_handled_at,
               extract(epoch FROM ends_at - started_at)::integer AS ends_after_seconds
        FROM stages
        WHERE id = $1;
    `, [phaseId]);
    return row;
}

// Moves the deadline of a phase to one second ago, as if its time had run out.
async function expireDeadline(phaseId) {
    await query("UPDATE stages SET ends_at = now() - interval '1 second' WHERE id = $1;",
        [phaseId]);
}

async function startPhases(starter, { sessionId, teacherId }, count) {
    const phases = [];
    for (let number = 0; number < count; number += 1) {
        const result = await starter.startNextPhase({
            sessionId, teacherId, expectedPhaseNumber: number,
        });
        assert.equal(result.status, "started");
        phases.push(result.phase.id);
    }
    return phases;
}

test("a phase records its start, its trigger and its deadline from the database's clock", {
    skip: SKIP_REASON,
}, async () => {
    for (const timeMode of ["soft", "hard"]) {
        const { teacherId, sessionId } = await createActivity({ design: TIMED_DESIGN, timeMode });
        const transactionTimes = [];
        const { starter } = makeStarter({ transactionTimes });

        const result = await starter.startNextPhase({
            sessionId, teacherId, expectedPhaseNumber: 0,
        });

        assert.equal(result.status, "started");
        assert.equal(result.trigger, "teacher");
        const { started_at: startedAt, ends_at: endsAt, ...clock } =
            await clockOf(result.phase.id);
        // now() of the start's own transaction, to the microsecond, which no
        // Node clock would match.
        const [{ same_start: sameStart }] = await query(
            "SELECT $1::timestamptz = $2::timestamptz AS same_start;",
            [startedAt, transactionTimes[0]]
        );
        assert.equal(sameStart, true, `${timeMode}: ${startedAt} ${transactionTimes[0]}`);
        assert.notEqual(endsAt, null);
        assert.deepEqual(clock, {
            duration_seconds:    300,
            start_trigger:       "teacher",
            deadline_handled_at: null,
            ends_after_seconds:  300,
        }, timeMode);
    }
});

test("no deadline without a time mode or without a duration; the start is still recorded", {
    skip: SKIP_REASON,
}, async () => {
    const untimed = await createActivity({ design: TIMED_DESIGN, timeMode: "none" });
    const timed = await createActivity({ design: TIMED_DESIGN, timeMode: "hard" });
    const { starter } = makeStarter();

    const untimedPhases = await startPhases(starter, untimed, 1);
    // The third phase of the hard-mode design has no duration.
    const timedPhases = await startPhases(starter, timed, 3);

    for (const phaseId of [untimedPhases[0], timedPhases[2]]) {
        const clock = await clockOf(phaseId);
        assert.notEqual(clock.started_at, null);
        assert.equal(clock.start_trigger, "teacher");
        assert.equal(clock.duration_seconds, null);
        assert.equal(clock.ends_at, null);
    }
    assert.equal((await clockOf(timedPhases[1])).duration_seconds, 600);
});

test("a teacher's start marks the deadline of the phase it leaves as handled", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity({ design: TIMED_DESIGN, timeMode: "hard" });
    const { starter } = makeStarter();

    // Moving on early, before phase 1's deadline.
    const [first, second, third] = await startPhases(starter, activity, 3);

    const [firstClock, secondClock, thirdClock] =
        await Promise.all([first, second, third].map(clockOf));
    assert.equal(firstClock.deadline_handled_at, secondClock.started_at);
    assert.equal(secondClock.deadline_handled_at, thirdClock.started_at);
    assert.equal(thirdClock.deadline_handled_at, null, "the current phase is not handled");

    // The runner, late for phase 2's deadline, finds the activity moved on.
    await expireDeadline(second);
    assert.deepEqual(await starter.startNextPhase({
        ...activity, expectedPhaseNumber: 2, trigger: "deadline",
    }), { status: "stale", currentPhaseNumber: 3 });
});

test("a start by the deadline advances a hard-mode phase whose deadline passed", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity({ design: TIMED_DESIGN, timeMode: "hard" });
    const { starter, effects } = makeStarter();
    const [first] = await startPhases(starter, activity, 1);
    await expireDeadline(first);
    effects.length = 0;

    const result = await starter.startNextPhase({
        ...activity, expectedPhaseNumber: 1, trigger: "deadline",
    });
    await result.hooks;

    assert.equal(result.status, "started");
    assert.equal(result.trigger, "deadline");
    assert.equal(result.phase.number, 2);
    const [leaving, started] = await Promise.all([first, result.phase.id].map(clockOf));
    assert.equal(leaving.deadline_handled_at, started.started_at);
    assert.equal(started.start_trigger, "deadline");
    assert.equal(started.ends_after_seconds, 600);
    assert.deepEqual(await sessionOf(activity.sessionId),
        { status: IN_PROGRESS, currentStage: result.phase.id });
    assert.deepEqual(effects, [
        ["invalidate", activity.sessionId],
        ["notify", activity.sessionId],
        ["phase-ended", first],
        ["phase-started", result.phase.id],
    ]);
});

test("a start by the deadline is not due before the deadline, in soft mode or once handled", {
    skip: SKIP_REASON,
}, async () => {
    const { starter, effects } = makeStarter();
    const byDeadline = activity => starter.startNextPhase({
        ...activity, expectedPhaseNumber: 1, trigger: "deadline",
    });
    const notDue = { status: "not_due", currentPhaseNumber: 1 };

    async function unchanged(activity, phaseId, check) {
        const before = { rows: await countRows(activity.sessionId), clock: await clockOf(phaseId) };
        effects.length = 0;
        await check();
        assert.deepEqual(await countRows(activity.sessionId), before.rows);
        assert.deepEqual(await clockOf(phaseId), before.clock);
        assert.deepEqual(await sessionOf(activity.sessionId),
            { status: IN_PROGRESS, currentStage: phaseId });
        assert.deepEqual(effects, []);
    }

    // Hard mode, five minutes left.
    const running = await createActivity({ design: TIMED_DESIGN, timeMode: "hard" });
    const [runningPhase] = await startPhases(starter, running, 1);
    await unchanged(running, runningPhase, async () => {
        assert.deepEqual(await byDeadline(running), notDue);
    });

    // Soft mode, past the deadline: only the teacher moves on.
    const soft = await createActivity({ design: TIMED_DESIGN, timeMode: "soft" });
    const [softPhase] = await startPhases(starter, soft, 1);
    await expireDeadline(softPhase);
    await unchanged(soft, softPhase, async () => {
        assert.deepEqual(await byDeadline(soft), notDue);
    });

    // Hard mode, past a deadline already handled.
    const handled = await createActivity({ design: TIMED_DESIGN, timeMode: "hard" });
    const [handledPhase] = await startPhases(starter, handled, 1);
    await expireDeadline(handledPhase);
    await query("UPDATE stages SET deadline_handled_at = now() WHERE id = $1;", [handledPhase]);
    await unchanged(handled, handledPhase, async () => {
        assert.deepEqual(await byDeadline(handled), notDue);
    });

    // Before the first phase there is no deadline.
    const notStarted = await createActivity({ design: TIMED_DESIGN, timeMode: "hard" });
    assert.deepEqual(await starter.startNextPhase({
        ...notStarted, expectedPhaseNumber: 0, trigger: "deadline",
    }), { status: "not_due", currentPhaseNumber: 0 });
    assert.equal((await countRows(notStarted.sessionId)).stages, 0);
});

test("the deadline of the last phase is handled without finishing the activity", {
    skip: SKIP_REASON,
}, async () => {
    const design = { ...TIMED_DESIGN, phases: TIMED_DESIGN.phases.slice(0, 2) };
    const activity = await createActivity({ design, timeMode: "hard" });
    const { starter, effects } = makeStarter();
    const [, last] = await startPhases(starter, activity, 2);
    await expireDeadline(last);
    effects.length = 0;
    const rowsBefore = await countRows(activity.sessionId);

    const atLast = { ...activity, expectedPhaseNumber: 2 };
    assert.deepEqual(await starter.startNextPhase({ ...atLast, trigger: "deadline" }),
        { status: "no_next_phase", currentPhaseNumber: 2 });

    assert.notEqual((await clockOf(last)).deadline_handled_at, null, "the runner stops");
    assert.deepEqual(await sessionOf(activity.sessionId),
        { status: IN_PROGRESS, currentStage: last });
    assert.deepEqual(await countRows(activity.sessionId), rowsBefore);
    assert.deepEqual(effects, []);

    // A second tick finds nothing to do; the teacher still finishes it by hand.
    assert.deepEqual(await starter.startNextPhase({ ...atLast, trigger: "deadline" }),
        { status: "not_due", currentPhaseNumber: 2 });
    assert.deepEqual(await starter.startNextPhase(atLast),
        { status: "no_next_phase", currentPhaseNumber: 2 });
});

test("of the teacher and the deadline starting a phase at once, or two deadline starts, one "
    + "starts it", { skip: SKIP_REASON }, async () => {
    for (const triggers of [["teacher", "deadline"], ["deadline", "teacher"],
        ["deadline", "deadline"]]) {
        const activity = await createActivity({ design: TIMED_DESIGN, timeMode: "hard" });
        const [first] = await startPhases(makeStarter().starter, activity, 1);
        await expireDeadline(first);

        const pids = [];
        const { starter } = makeStarter({ onConnect: recordPid(pids) });
        const blocker = await getPool().connect();
        let results;
        try {
            await blocker.query("BEGIN");
            await blocker.query(LOCK_SESSION_SQL, [activity.sessionId]);

            const requests = triggers.map(trigger => starter.startNextPhase({
                ...activity, expectedPhaseNumber: 1, trigger,
            }));
            while (pids.length < 2) {
                await delay(20);
            }
            await Promise.all(pids.map(waitUntilBlockedOnLock));
            await blocker.query("COMMIT");
            results = await Promise.all(requests);
        } finally {
            blocker.release();
        }

        const label = triggers.join(" vs ");
        const winners = results.filter(result => result.status === "started");
        assert.equal(winners.length, 1, label);
        assert.deepEqual(results.filter(result => result.status !== "started"),
            [{ status: "stale", currentPhaseNumber: 2 }], label);

        const phases = await phasesOf(activity.sessionId);
        assert.deepEqual(phases.map(phase => phase.number), [1, 2], label);
        const [leaving, started] = await Promise.all([first, winners[0].phase.id].map(clockOf));
        assert.equal(started.start_trigger, winners[0].trigger, label);
        assert.equal(leaving.deadline_handled_at, started.started_at, label);
    }
});

test("a start by the deadline sees an extension committed while it waits for the phase", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity({ design: TIMED_DESIGN, timeMode: "hard" });
    const [first] = await startPhases(makeStarter().starter, activity, 1);
    await expireDeadline(first);

    const pids = [];
    const { starter } = makeStarter({ onConnect: recordPid(pids) });
    // "+1 min", committed after the start read the session but before its claim.
    const extension = await getPool().connect();
    try {
        await extension.query("BEGIN");
        await extension.query(
            "UPDATE stages SET ends_at = now() + interval '1 minute' WHERE id = $1;",
            [first]
        );

        const request = starter.startNextPhase({
            ...activity, expectedPhaseNumber: 1, trigger: "deadline",
        });
        while (pids.length < 1) {
            await delay(20);
        }
        await waitUntilBlockedOnLock(pids[0]);
        await extension.query("COMMIT");

        assert.deepEqual(await request, { status: "not_due", currentPhaseNumber: 1 });
    } finally {
        extension.release();
    }
    assert.equal((await clockOf(first)).deadline_handled_at, null);
    assert.equal((await countRows(activity.sessionId)).stages, 1);
});

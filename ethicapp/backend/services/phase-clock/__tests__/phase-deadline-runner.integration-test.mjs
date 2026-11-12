// Integration tests for the phase deadline runner (#1113, epic #1105),
// against a real PostgreSQL database with migrations V1-V45 applied: the
// runner's statements, the real phase start (helpers/phase-start-helper.js)
// with its students' descriptor, notifications and hooks recorded in place of
// Redis, Socket.IO and the external services, and a fake teacher notice.
// Covered: a hard-mode phase advanced once when the runner races the
// teacher's click or a second runner; a phase not due, or extended, left
// alone; the last phase's deadline marked handled and notified once, and
// again after an extension; a start that throws rolled back and retried
// after a backoff; and the due deadlines no runner enforces (soft mode, a
// finished activity, no time mode, a phase no longer current) marked handled
// without any phase start.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert users, designs, sessions and
// phases of their own, which are not removed. The database may hold due
// deadlines of other suites, so the runners here act on this file's sessions
// only.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import pg from "pg";

import { createPhaseStarter, LOCK_SESSION_SQL } from "../../../helpers/phase-start-helper.js";
import { createPhaseDeadlineRunner } from "../phase-deadline-runner.js";
import {
    createPhaseDeadlineStore,
    DUE_ENFORCED_DEADLINES_SQL,
    SETTLE_UNENFORCED_DEADLINES_SQL,
} from "../phase-deadline-store.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

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

function individualPhase(durationMinutes) {
    return {
        mode:               "individual",
        anonymous:          false,
        chat:               false,
        grouping_algorithm: "random",
        stdntAmount:        3,
        prevPhasesResponse: [],
        ...(durationMinutes ? { durationMinutes } : {}),
        questions:          [{
            q_text:     "A question",
            ans_format: { l_pole: "Left", r_pole: "Right", values: 7, just_required: false },
        }],
    };
}

// Three timed phases.
const TIMED_DESIGN = {
    type:   "semantic_differential",
    phases: [individualPhase(5), individualPhase(5), individualPhase(5)],
};

// Its second phase keeps the groups of an earlier team phase, which there
// is none of: starting it throws (helpers/groups-helper.js).
const PRESERVE_WITHOUT_TEAMS_DESIGN = {
    type:   "semantic_differential",
    phases: [
        individualPhase(5),
        { ...individualPhase(5), mode: "team", grouping_algorithm: "preserve", stdntAmount: 2 },
    ],
};

// The sessions this file created; the runners act on these only.
const ownSessions = new Set();

async function insertUser(role) {
    const [user] = await query(`
        INSERT INTO users (name, mail, role)
        VALUES ('Integration user', $1, $2)
        RETURNING id;
    `, [`${randomUUID()}@integration.test`, role]);
    return Number(user.id);
}

async function createActivity({ design = TIMED_DESIGN, timeMode = "hard" } = {}) {
    const teacherId = await insertUser("P");
    const [{ id: designId }] = await query(
        "INSERT INTO designs (creator, design, locked) VALUES ($1, $2, true) RETURNING id;",
        [teacherId, design]
    );
    const [{ id }] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type, time_mode)
        VALUES ('Integration session', '', $1, now(), 1, 'T', $2)
        RETURNING id;
    `, [teacherId, timeMode]);
    const sessionId = Number(id);
    await query("INSERT INTO activity (design, session) VALUES ($1, $2);", [designId, sessionId]);
    await query("INSERT INTO sesusers (sesid, uid) VALUES ($1, $2);", [sessionId, teacherId]);
    ownSessions.add(sessionId);
    return { teacherId, sessionId };
}

/**
 * A phase start on the test database. `effects` records what it does after
 * a commit; `onConnect` sees each checked-out client.
 */
function makeStarter({ onConnect = async () => {} } = {}) {
    const effects = [];
    const starter = createPhaseStarter({
        connect: async () => {
            const client = await getPool().connect();
            await onConnect(client);
            return client;
        },
        invalidateStudentDescriptor: async (sessionId) => {
            effects.push(["invalidate", sessionId]);
        },
        notifyPhaseStarted: async (sessionId, transition) => {
            effects.push(["phaseStarted", sessionId, transition]);
        },
        dispatchPhaseHook: async () => {},
        logger:            { warn() {}, error() {} },
    });
    return { starter, effects };
}

const silentLogger = { info() {}, warn() {}, error() {} };

/**
 * A runner on the test database whose store lists this file's sessions only.
 * `notices` records the teacher notices; `listed` each listing, unfiltered
 * by the runner's exclusions only.
 */
function makeRunner({ starter = makeStarter().starter, now } = {}) {
    const store = createPhaseDeadlineStore({
        dbQuery: async (sql, params) => (await getPool().query(sql, params)).rows,
    });
    const notices = [];
    const errors = [];
    const runner = createPhaseDeadlineRunner({
        store: {
            ...store,
            listDueEnforced: async options => (await store.listDueEnforced(options))
                .filter(deadline => ownSessions.has(deadline.sessionId)),
        },
        startNextPhase: request => starter.startNextPhase(request),
        notifier:       {
            deadlineReached: (sessionId, payload) => notices.push([sessionId, payload]),
        },
        logger: { ...silentLogger, error: (...args) => errors.push(args.join(" ")) },
        ...(now ? { now } : {}),
    });
    return { runner, notices, errors, store };
}

async function startPhases({ sessionId, teacherId }, count) {
    const { starter } = makeStarter();
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

async function expireDeadline(phaseId) {
    await query("UPDATE stages SET ends_at = now() - interval '1 second' WHERE id = $1;",
        [phaseId]);
}

// "+1 min" as #1112 records it: a later deadline, not handled.
async function extendDeadline(phaseId) {
    await query(`
        UPDATE stages
        SET ends_at = greatest(ends_at, now()) + interval '1 minute',
            deadline_handled_at = NULL
        WHERE id = $1;
    `, [phaseId]);
}

async function phasesOf(sessionId) {
    const rows = await query(`
        SELECT id, number, start_trigger, deadline_handled_at IS NOT NULL AS handled
        FROM stages
        WHERE sesid = $1
        ORDER BY number;
    `, [sessionId]);
    return rows.map(row => ({ ...row, id: Number(row.id), number: Number(row.number) }));
}

async function sessionOf(sessionId) {
    const [row] = await query("SELECT status, current_stage FROM sessions WHERE id = $1;",
        [sessionId]);
    return {
        status:       Number(row.status),
        currentStage: row.current_stage === null ? null : Number(row.current_stage),
    };
}

async function isHandled(phaseId) {
    const [row] = await query(
        "SELECT deadline_handled_at IS NOT NULL AS handled FROM stages WHERE id = $1;",
        [phaseId]
    );
    return row.handled;
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

function recordPid(pids) {
    return async (client) => {
        const { rows: [{ pid }] } = await client.query("SELECT pg_backend_pid() AS pid;");
        pids.push(pid);
    };
}

/**
 * Runs `contenders` (functions that start a phase) while another
 * transaction holds the session's lock, so that both wait for it, and
 * releases it once both are blocked.
 */
async function raceOnSessionLock(sessionId, pids, contenders) {
    const blocker = await getPool().connect();
    try {
        await blocker.query("BEGIN");
        await blocker.query(LOCK_SESSION_SQL, [sessionId]);
        const running = contenders.map(contender => contender());
        while (pids.length < contenders.length) {
            await delay(20);
        }
        await Promise.all(pids.map(waitUntilBlockedOnLock));
        await blocker.query("COMMIT");
        return await Promise.all(running);
    } finally {
        blocker.release();
    }
}

test("a hard-mode phase whose deadline passed advances on the runner's tick", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity();
    const [first] = await startPhases(activity, 1);
    await expireDeadline(first);
    const { starter, effects } = makeStarter();
    const { runner, notices } = makeRunner({ starter });

    const { outcomes } = await runner.processDue();

    assert.equal(outcomes.started, 1);
    const phases = await phasesOf(activity.sessionId);
    assert.deepEqual(phases.map(({ number, start_trigger: trigger, handled }) =>
        [number, trigger, handled]), [[1, "teacher", true], [2, "deadline", false]]);
    assert.deepEqual(await sessionOf(activity.sessionId),
        { status: IN_PROGRESS, currentStage: phases[1].id });
    assert.deepEqual(effects, [
        ["invalidate", activity.sessionId],
        ["phaseStarted", activity.sessionId,
            { phaseId: phases[1].id, phaseNumber: 2, reason: "deadline" }],
    ]);
    assert.deepEqual(notices, []);

    // The next tick finds nothing due for it.
    assert.equal((await runner.processDue()).outcomes.started, undefined);
    assert.equal((await phasesOf(activity.sessionId)).length, 2);
});

test("the runner and the teacher's click starting a phase at once advance it once", {
    skip: SKIP_REASON,
}, async () => {
    for (const order of [["runner", "teacher"], ["teacher", "runner"]]) {
        const activity = await createActivity();
        const [first] = await startPhases(activity, 1);
        await expireDeadline(first);

        const pids = [];
        const { starter } = makeStarter({ onConnect: recordPid(pids) });
        const { runner } = makeRunner({ starter });
        const contenders = {
            runner:  () => runner.processDue(),
            teacher: () => starter.startNextPhase({ ...activity, expectedPhaseNumber: 1 }),
        };

        const results = await raceOnSessionLock(activity.sessionId, pids,
            order.map(name => contenders[name]));

        const label = order.join(" vs ");
        const byName = Object.fromEntries(order.map((name, i) => [name, results[i]]));
        const runnerStarted = byName.runner.outcomes.started === 1;
        const teacherStarted = byName.teacher.status === "started";
        assert.notEqual(runnerStarted, teacherStarted, `${label}: exactly one starts it`);
        if (!runnerStarted) {
            assert.deepEqual(byName.runner.outcomes, { stale: 1 }, label);
        } else {
            assert.deepEqual(byName.teacher, { status: "stale", currentPhaseNumber: 2 }, label);
        }
        const phases = await phasesOf(activity.sessionId);
        assert.deepEqual(phases.map(phase => phase.number), [1, 2], label);
        assert.equal(phases[1].start_trigger, runnerStarted ? "deadline" : "teacher", label);
        assert.equal(phases[0].handled, true, label);
    }
});

test("two runners at once advance a phase once", { skip: SKIP_REASON }, async () => {
    const activity = await createActivity();
    const [first] = await startPhases(activity, 1);
    await expireDeadline(first);

    const pids = [];
    const { starter } = makeStarter({ onConnect: recordPid(pids) });
    const one = makeRunner({ starter });
    const other = makeRunner({ starter });

    const results = await raceOnSessionLock(activity.sessionId, pids,
        [() => one.runner.processDue(), () => other.runner.processDue()]);

    const outcomes = results.map(result => result.outcomes);
    assert.equal(outcomes.filter(outcome => outcome.started === 1).length, 1);
    assert.deepEqual(outcomes.find(outcome => outcome.started !== 1), { stale: 1 });
    const phases = await phasesOf(activity.sessionId);
    assert.deepEqual(phases.map(phase => [phase.number, phase.start_trigger]),
        [[1, "teacher"], [2, "deadline"]]);
});

test("a phase not yet due, or extended, is left alone", { skip: SKIP_REASON }, async () => {
    const running = await createActivity();
    const [runningPhase] = await startPhases(running, 1);
    const extended = await createActivity();
    const [extendedPhase] = await startPhases(extended, 1);
    await expireDeadline(extendedPhase);
    await extendDeadline(extendedPhase);
    const { runner, store } = makeRunner();

    await runner.processDue();

    for (const [activity, phaseId] of [[running, runningPhase], [extended, extendedPhase]]) {
        assert.deepEqual(await sessionOf(activity.sessionId),
            { status: IN_PROGRESS, currentStage: phaseId });
        assert.equal((await phasesOf(activity.sessionId)).length, 1);
        assert.equal(await isHandled(phaseId), false);
    }
    const listed = await store.listDueEnforced({ limit: 1000 });
    assert.ok(!listed.some(deadline => [runningPhase, extendedPhase].includes(deadline.phaseId)));

    // Once the extended deadline passes, the phase advances.
    await expireDeadline(extendedPhase);
    await runner.processDue();
    assert.equal((await phasesOf(extended.sessionId)).length, 2);
});

test("the last phase's deadline is marked handled and notified once, and again once extended",
    { skip: SKIP_REASON }, async () => {
        const design = { ...TIMED_DESIGN, phases: TIMED_DESIGN.phases.slice(0, 2) };
        const activity = await createActivity({ design });
        const [, last] = await startPhases(activity, 2);
        await expireDeadline(last);
        const { runner, notices } = makeRunner();

        assert.equal((await runner.processDue()).outcomes.no_next_phase, 1);
        await runner.processDue();

        assert.deepEqual(notices, [[activity.sessionId, { phaseId: last, isLastPhase: true }]]);
        assert.equal(await isHandled(last), true);
        assert.deepEqual(await sessionOf(activity.sessionId),
            { status: IN_PROGRESS, currentStage: last }, "the activity is not finished");
        assert.equal((await phasesOf(activity.sessionId)).length, 2);

        // "+1 min" after the notice: a second notice at the new deadline.
        await extendDeadline(last);
        await runner.processDue();
        assert.equal(notices.length, 1, "not before the new deadline");
        await expireDeadline(last);
        await runner.processDue();
        await runner.processDue();
        assert.equal(notices.length, 2);
        assert.equal(await isHandled(last), true);
    });

test("a start that throws is rolled back and retried after its backoff", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity({ design: PRESERVE_WITHOUT_TEAMS_DESIGN });
    const [first] = await startPhases(activity, 1);
    await expireDeadline(first);
    let clock = 0;
    const { runner, errors } = makeRunner({ now: () => clock });

    assert.deepEqual((await runner.processDue()).outcomes, { error: 1 });
    assert.match(errors[0], /No previous group phase found.*retrying in 5 s/);
    assert.equal(await isHandled(first), false, "the claim is rolled back");
    assert.deepEqual(await sessionOf(activity.sessionId),
        { status: IN_PROGRESS, currentStage: first });

    // Within its backoff the phase is not tried.
    assert.deepEqual((await runner.processDue()).outcomes, {});
    clock += 5000;
    assert.deepEqual((await runner.processDue()).outcomes, { error: 1 });
    assert.match(errors[1], /retrying in 10 s/);

    // The teacher moves on by hand meanwhile: nothing is left to retry.
    await query("UPDATE stages SET deadline_handled_at = now() WHERE id = $1;", [first]);
    clock += 10000;
    assert.deepEqual((await runner.processDue()).outcomes, {});
});

test("due deadlines that no runner enforces are marked handled without a phase start", {
    skip: SKIP_REASON,
}, async () => {
    // A soft-mode phase past its deadline, one not yet due, a hard-mode
    // activity finished on its phase, a phase of an activity without a time
    // mode given a deadline by hand, and an enforced one.
    const soft = await createActivity({ timeMode: "soft" });
    const [softPhase] = await startPhases(soft, 1);
    await expireDeadline(softPhase);

    const softRunning = await createActivity({ timeMode: "soft" });
    const [softRunningPhase] = await startPhases(softRunning, 1);

    const finished = await createActivity();
    const [finishedPhase] = await startPhases(finished, 1);
    await query("UPDATE sessions SET status = $1, current_stage = NULL WHERE id = $2;",
        [FINISHED, finished.sessionId]);
    await expireDeadline(finishedPhase);

    const untimed = await createActivity({ timeMode: "none" });
    const [untimedPhase] = await startPhases(untimed, 1);
    await expireDeadline(untimedPhase);

    const enforced = await createActivity();
    const [enforcedPhase] = await startPhases(enforced, 1);
    await expireDeadline(enforcedPhase);

    const { store } = makeRunner();
    const settled = await store.settleUnenforced({ limit: 1000 });

    assert.ok(settled >= 3);
    for (const phaseId of [softPhase, finishedPhase, untimedPhase]) {
        assert.equal(await isHandled(phaseId), true, `phase ${phaseId}`);
    }
    assert.equal(await isHandled(softRunningPhase), false, "not due yet");
    assert.equal(await isHandled(enforcedPhase), false, "the runner's to start");
    for (const activity of [soft, untimed, enforced]) {
        assert.equal((await phasesOf(activity.sessionId)).length, 1);
    }
    assert.deepEqual(await sessionOf(finished.sessionId),
        { status: FINISHED, currentStage: null });

    // Only the enforced deadline is left in the partial index of V45.
    const pending = await query(`
        SELECT id
        FROM stages
        WHERE ends_at IS NOT NULL
          AND deadline_handled_at IS NULL
          AND id = ANY($1::integer[]);
    `, [[softPhase, softRunningPhase, finishedPhase, untimedPhase, enforcedPhase]]);
    assert.deepEqual(pending.map(row => Number(row.id)).sort((a, b) => a - b),
        [softRunningPhase, enforcedPhase].sort((a, b) => a - b));

    // A soft-mode teacher still moves on by hand, and the next phase's own
    // deadline is not marked.
    const { starter } = makeStarter();
    const next = await starter.startNextPhase({ ...soft, expectedPhaseNumber: 1 });
    assert.equal(next.status, "started");
    assert.equal(await isHandled(next.phase.id), false);
});

test("the runner's statements use the partial index of pending deadlines", {
    skip: SKIP_REASON,
}, async () => {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("SET LOCAL enable_seqscan = off");
        for (const [sql, params] of [
            [DUE_ENFORCED_DEADLINES_SQL, [IN_PROGRESS, 20, []]],
            [SETTLE_UNENFORCED_DEADLINES_SQL, [IN_PROGRESS, 20]],
        ]) {
            const { rows } = await client.query(`EXPLAIN ${sql}`, params);
            const plan = rows.map(row => row["QUERY PLAN"]).join("\n");
            assert.match(plan, /idx_stages_pending_deadline/, plan);
        }
    } finally {
        await client.query("ROLLBACK");
        client.release();
    }
});

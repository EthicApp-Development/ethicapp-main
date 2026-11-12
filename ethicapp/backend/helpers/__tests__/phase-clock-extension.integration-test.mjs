// Integration tests for "+1 min" (#1112, epic #1105), against a real
// PostgreSQL database with migrations V1-V45 applied: the one conditional
// statement that adds a minute to the current phase's deadline, with phases
// started by the real phase starter. One extension adds 60 seconds, two with
// the same expected deadline add it once, a finished activity, a phase that is
// not current, an activity without a time mode, a phase without a duration and
// a hard deadline that passed unhandled are refused, a deadline that passed
// restarts at one minute from now (decision of 2026-11-11), and an extension
// resets the deadline the runner handled. The locks, the database's clock and the
// precision of timestamptz cannot be checked with fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert users, designs, sessions and
// phases of their own, which are not removed.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import pg from "pg";

import { extendPhaseDeadline } from "../phase-clock-extension.js";
import { readPhaseClock } from "../phase-clock.js";
import {
    createPhaseStarter,
    LOCK_SESSION_SQL,
    MARK_DEADLINE_HANDLED_SQL,
} from "../phase-start-helper.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

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

function phase(durationMinutes) {
    return {
        mode:               "individual",
        anonymous:          false,
        chat:               false,
        prevPhasesResponse: [],
        ...(durationMinutes === undefined ? {} : { durationMinutes }),
        questions:          [{
            q_text:     "Question",
            ans_format: {
                l_pole:          "Left",
                r_pole:          "Right",
                values:          7,
                just_required:   false,
                min_just_length: 0,
            },
        }],
    };
}

// Five minutes, then a phase without a duration, then ten minutes.
const MIXED_DESIGN = {
    type:   "semantic_differential",
    phases: [phase(5), phase(), phase(10)],
};

async function insertUser(role) {
    const [user] = await query(`
        INSERT INTO users (name, mail, role)
        VALUES ('Integration user', $1, $2)
        RETURNING id;
    `, [`${randomUUID()}@integration.test`, role]);
    return Number(user.id);
}

async function createActivity({ timeMode = "soft" } = {}) {
    const teacherId = await insertUser("P");
    const [{ id: sessionId }] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type, time_mode)
        VALUES ('Integration session', '', $1, now(), 1, 'T', $2)
        RETURNING id;
    `, [teacherId, timeMode]);
    const [{ id: designId }] = await query(
        "INSERT INTO designs (creator, design, locked) VALUES ($1, $2, true) RETURNING id;",
        [teacherId, MIXED_DESIGN]
    );
    await query("INSERT INTO activity (design, session) VALUES ($1, $2);",
        [designId, sessionId]);
    return { teacherId, sessionId: Number(sessionId) };
}

const starter = createPhaseStarter({
    connect:                     () => getPool().connect(),
    invalidateStudentPhaseState: async () => {},
    notifyPhaseStarted:          async () => {},
    dispatchPhaseHook:           async () => {},
    logger:                      { warn() {}, error() {} },
});

// Starts phases 1 to `count`; resolves to their ids.
async function startPhases({ teacherId, sessionId }, count) {
    const ids = [];
    for (let number = 0; number < count; number += 1) {
        const result = await starter.startNextPhase({
            sessionId, teacherId, expectedPhaseNumber: number,
        });
        assert.equal(result.status, "started");
        ids.push(result.phase.id);
    }
    return ids;
}

async function phaseClock(phaseId) {
    const [row] = await query(`
        SELECT ends_at, deadline_handled_at
        FROM stages
        WHERE id = $1;
    `, [phaseId]);
    return row;
}

// Moves a phase's deadline `seconds` into the past, unhandled.
async function expireDeadline(phaseId, seconds = 1) {
    await query(`
        UPDATE stages
        SET ends_at = now() - $2::integer * interval '1 second',
            deadline_handled_at = NULL
        WHERE id = $1;
    `, [phaseId, seconds]);
}

const readClock = sessionId => readPhaseClock(sessionId, { query });

// The deadline as a client sees it, from the clock's ISO 8601 time.
const isoOf = date => date.toISOString();

function extend({ teacherId, sessionId }, phaseId, expectedEndsAt, run = query) {
    return extendPhaseDeadline(
        { sessionId, phaseId, teacherId, minutes: 1, expectedEndsAt },
        { query: run }
    );
}

const clientQuery = client => async (sql, params) => (await client.query(sql, params)).rows;

async function backendPid(client) {
    const { rows: [{ pid }] } = await client.query("SELECT pg_backend_pid() AS pid;");
    return pid;
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

// Waits until some backend running `sql` waits on a lock.
async function waitUntilQueryBlocked(sql) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const rows = await query(`
            SELECT pid
            FROM pg_stat_activity
            WHERE query = $1
              AND wait_event_type = 'Lock';
        `, [sql]);
        if (rows.length > 0) {
            return;
        }
        await delay(50);
    }
    throw new Error("No backend ever waited on a lock for the query.");
}

const secondsBetween = (from, to) => (to.getTime() - from.getTime()) / 1000;

test("one extension adds one minute to the deadline the clock shows", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity();
    const [first] = await startPhases(activity, 1);
    const before = await readClock(activity.sessionId);

    // The clock's endsAt has milliseconds; the column has microseconds.
    const result = await extend(activity, first, before.endsAt);

    assert.equal(result.status, "extended");
    assert.equal(result.phaseId, first);
    const after = await readClock(activity.sessionId);
    assert.equal((Date.parse(after.endsAt) - Date.parse(before.endsAt)) / 1000, 60);
    assert.equal(secondsBetween(new Date(before.endsAt), result.endsAt) >= 60, true);
    assert.equal((await phaseClock(first)).deadline_handled_at, null);

    // A second click, with the new deadline, adds another minute.
    assert.equal((await extend(activity, first, after.endsAt)).status, "extended");
    const later = await readClock(activity.sessionId);
    assert.equal((Date.parse(later.endsAt) - Date.parse(before.endsAt)) / 1000, 120);
});

test("two extensions with the same expected deadline add one minute", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity({ timeMode: "hard" });
    const [first] = await startPhases(activity, 1);
    const { ends_at: endsAt } = await phaseClock(first);

    const one = await getPool().connect();
    const two = await getPool().connect();
    try {
        // The first one has updated the phase but not committed.
        await one.query("BEGIN");
        const firstResult = await extend(activity, first, isoOf(endsAt), clientQuery(one));
        assert.equal(firstResult.status, "extended");

        const pid = await backendPid(two);
        const second = extend(activity, first, isoOf(endsAt), clientQuery(two));
        await waitUntilBlockedOnLock(pid);
        await one.query("COMMIT");

        assert.deepEqual(await second, { status: "deadline_changed" });
    } finally {
        one.release();
        two.release();
    }
    assert.equal(secondsBetween(endsAt, (await phaseClock(first)).ends_at), 60);
});

test("many extensions sent at once with the same expected deadline add one minute", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity();
    const [first] = await startPhases(activity, 1);
    const { ends_at: endsAt } = await phaseClock(first);

    const results = await Promise.all(
        Array.from({ length: 6 }, () => extend(activity, first, isoOf(endsAt)))
    );

    assert.deepEqual(results.map(result => result.status).sort(), [
        "deadline_changed", "deadline_changed", "deadline_changed",
        "deadline_changed", "deadline_changed", "extended",
    ]);
    assert.equal(secondsBetween(endsAt, (await phaseClock(first)).ends_at), 60);
});

test("an extension of a finished activity is refused", { skip: SKIP_REASON }, async () => {
    const activity = await createActivity();
    const [first] = await startPhases(activity, 1);
    const { ends_at: endsAt } = await phaseClock(first);
    await query("UPDATE sessions SET status = $1, current_stage = NULL WHERE id = $2;",
        [FINISHED, activity.sessionId]);

    assert.deepEqual(await extend(activity, first, isoOf(endsAt)), { status: "finished" });
    assert.deepEqual((await phaseClock(first)).ends_at, endsAt);
});

test("an extension of a phase that is not the current one is refused", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity();
    const [first] = await startPhases(activity, 1);
    const { ends_at: endsAt } = await phaseClock(first);
    await starter.startNextPhase({ ...activity, expectedPhaseNumber: 1 });
    const handledAt = (await phaseClock(first)).deadline_handled_at;

    assert.deepEqual(await extend(activity, first, isoOf(endsAt)), { status: "not_current" });
    // The deadline the teacher's start handled stays so.
    assert.deepEqual(await phaseClock(first), { ends_at: endsAt, deadline_handled_at: handledAt });
});

test("an activity without a time mode and a phase without a duration have no deadline", {
    skip: SKIP_REASON,
}, async () => {
    const untimed = await createActivity({ timeMode: "none" });
    const [untimedPhase] = await startPhases(untimed, 1);
    // A deadline written anyway is not extended in an activity without a mode.
    await query("UPDATE stages SET ends_at = now() + interval '5 minutes' WHERE id = $1;",
        [untimedPhase]);
    const { ends_at: written } = await phaseClock(untimedPhase);
    assert.deepEqual(await extend(untimed, untimedPhase, isoOf(written)),
        { status: "no_deadline" });
    assert.deepEqual((await phaseClock(untimedPhase)).ends_at, written);

    const mixed = await createActivity({ timeMode: "hard" });
    const [, withoutDuration] = await startPhases(mixed, 2);
    assert.equal((await phaseClock(withoutDuration)).ends_at, null);
    assert.deepEqual(await extend(mixed, withoutDuration, isoOf(new Date())),
        { status: "no_deadline" });
});

test("a hard deadline that passed and was not handled is not extended", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity({ timeMode: "hard" });
    const [first] = await startPhases(activity, 1);
    await expireDeadline(first);
    const { ends_at: endsAt } = await phaseClock(first);

    assert.deepEqual(await extend(activity, first, isoOf(endsAt)),
        { status: "deadline_passed" });
    assert.deepEqual(await phaseClock(first), { ends_at: endsAt, deadline_handled_at: null });
});

// The deadline's distance from the database's now(), in seconds.
async function secondsLeft(phaseId) {
    const [{ left }] = await query(`
        SELECT extract(epoch FROM ends_at - now())::float AS left
        FROM stages
        WHERE id = $1;
    `, [phaseId]);
    return left;
}

test("a soft deadline that passed restarts at one minute from now", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity({ timeMode: "soft" });
    const [first] = await startPhases(activity, 1);
    await expireDeadline(first, 135);
    const { ends_at: endsAt } = await phaseClock(first);

    const result = await extend(activity, first, isoOf(endsAt));

    assert.equal(result.status, "extended");
    const extended = await phaseClock(first);
    assert.deepEqual(extended.ends_at, result.endsAt);
    // One minute from the extension, not from the deadline that passed.
    const left = await secondsLeft(first);
    assert.ok(left > 55 && left <= 60, `${left} seconds left`);
    assert.equal(extended.deadline_handled_at, null);
});

test("the handled deadline of a hard last phase restarts at one minute and is due again", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity({ timeMode: "hard" });
    const [, , last] = await startPhases(activity, 3);
    // Long past: the teacher adds the minute five minutes after the notice.
    await expireDeadline(last, 300);
    // The deadline runner's start: the last phase is handled, not finished.
    assert.deepEqual(
        await starter.startNextPhase({ ...activity, expectedPhaseNumber: 3, trigger: "deadline" }),
        { status: "no_next_phase", currentPhaseNumber: 3 }
    );
    const handled = await phaseClock(last);
    assert.notEqual(handled.deadline_handled_at, null);

    assert.equal((await extend(activity, last, isoOf(handled.ends_at))).status, "extended");

    const extended = await phaseClock(last);
    assert.equal(extended.deadline_handled_at, null);
    const left = await secondsLeft(last);
    assert.ok(left > 55 && left <= 60, `${left} seconds left`);

    // Not due right after the extension: a deadline start writes nothing.
    assert.deepEqual(
        await starter.startNextPhase({ ...activity, expectedPhaseNumber: 3, trigger: "deadline" }),
        { status: "not_due", currentPhaseNumber: 3 }
    );
    assert.deepEqual(await phaseClock(last), extended);

    // Once the new deadline passes, the runner handles it again.
    await expireDeadline(last);
    assert.deepEqual(
        await starter.startNextPhase({ ...activity, expectedPhaseNumber: 3, trigger: "deadline" }),
        { status: "no_next_phase", currentPhaseNumber: 3 }
    );
    assert.notEqual((await phaseClock(last)).deadline_handled_at, null);
});

test("an extension waits for a phase start that holds the session and then is refused", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity({ timeMode: "hard" });
    const [first] = await startPhases(activity, 1);
    const { ends_at: endsAt } = await phaseClock(first);

    // A teacher's start, as phase-start-helper.js runs it: the session locked,
    // the leaving phase's deadline handled, the session moved to a new phase.
    const start = await getPool().connect();
    const extension = await getPool().connect();
    try {
        await start.query("BEGIN");
        await start.query(LOCK_SESSION_SQL, [activity.sessionId]);
        await start.query(MARK_DEADLINE_HANDLED_SQL, [first]);

        const pid = await backendPid(extension);
        const request = extend(activity, first, isoOf(endsAt), clientQuery(extension));
        await waitUntilBlockedOnLock(pid);

        const { rows: [{ id: next }] } = await start.query(`
            INSERT INTO stages (number, type, sesid, started_at, start_trigger)
            VALUES (2, 'individual', $1, now(), 'teacher')
            RETURNING id;
        `, [activity.sessionId]);
        await start.query("UPDATE sessions SET current_stage = $1 WHERE id = $2;",
            [next, activity.sessionId]);
        await start.query("COMMIT");

        assert.deepEqual(await request, { status: "not_current" });
    } finally {
        start.release();
        extension.release();
    }
    const left = await phaseClock(first);
    assert.deepEqual(left.ends_at, endsAt);
    assert.notEqual(left.deadline_handled_at, null);
});

test("a phase start waits for an extension that holds the session and sees its deadline", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity({ timeMode: "hard" });
    const [first] = await startPhases(activity, 1);
    await expireDeadline(first, -2);
    const { ends_at: endsAt } = await phaseClock(first);

    const extension = await getPool().connect();
    try {
        await extension.query("BEGIN");
        assert.equal(
            (await extend(activity, first, isoOf(endsAt), clientQuery(extension))).status,
            "extended"
        );
        // The old deadline passes while the extension holds the session.
        await delay(2500);
        const start = starter.startNextPhase({
            ...activity, expectedPhaseNumber: 1, trigger: "deadline",
        });
        await waitUntilQueryBlocked(LOCK_SESSION_SQL);
        await extension.query("COMMIT");

        assert.deepEqual(await start, { status: "not_due", currentPhaseNumber: 1 });
    } finally {
        extension.release();
    }
    const extended = await phaseClock(first);
    assert.equal(secondsBetween(endsAt, extended.ends_at), 60);
    assert.equal(extended.deadline_handled_at, null);
});

test("another teacher's session and another session's phase are refused", {
    skip: SKIP_REASON,
}, async () => {
    const activity = await createActivity();
    const other = await createActivity();
    const [first] = await startPhases(activity, 1);
    const [otherPhase] = await startPhases(other, 1);
    const { ends_at: endsAt } = await phaseClock(first);

    assert.deepEqual(
        await extend({ ...activity, teacherId: other.teacherId }, first, isoOf(endsAt)),
        { status: "not_found" }
    );
    assert.deepEqual(await extend(activity, otherPhase, isoOf(endsAt)),
        { status: "phase_not_found" });
    assert.deepEqual(await extend(activity, 2147483647, isoOf(endsAt)),
        { status: "phase_not_found" });
    assert.deepEqual((await phaseClock(first)).ends_at, endsAt);
});

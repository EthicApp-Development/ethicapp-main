// Integration tests for the phase clock (#1111, epic #1105), against a real
// PostgreSQL database with migrations V1-V45 applied: PHASE_CLOCK_SQL on an
// activity before its first phase, on timed and untimed phases started by the
// real phase starter, on its last phase, once finished, and for activities
// without a design or a time mode; the server's time from clock_timestamp()
// inside a transaction; and the clock the phase start's announcement reads
// after its commit. The database's clock and the jsonb functions cannot be
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

import { PHASE_CLOCK_SQL, readPhaseClock } from "../phase-clock.js";
import { createPhaseClockNotifier } from "../phase-clock-notifier.js";
import { createPhaseStarter } from "../phase-start-helper.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

const FINISHED = 3;

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
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

async function createActivity({ design = MIXED_DESIGN, timeMode = "hard", launched = true } = {}) {
    const teacherId = await insertUser("P");
    const [{ id: sessionId }] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type, time_mode)
        VALUES ('Integration session', '', $1, now(), 1, 'T', $2)
        RETURNING id;
    `, [teacherId, timeMode]);
    if (launched) {
        const [{ id: designId }] = await query(
            "INSERT INTO designs (creator, design, locked) VALUES ($1, $2, true) RETURNING id;",
            [teacherId, design]
        );
        await query("INSERT INTO activity (design, session) VALUES ($1, $2);",
            [designId, sessionId]);
    }
    return { teacherId, sessionId: Number(sessionId) };
}

const readClock = sessionId => readPhaseClock(sessionId, { query });

function makeStarter({ notifyPhaseStarted = async () => {} } = {}) {
    return createPhaseStarter({
        connect:                     () => getPool().connect(),
        invalidateStudentPhaseState: async () => {},
        notifyPhaseStarted,
        dispatchPhaseHook:           async () => {},
        logger:                      { warn() {}, error() {} },
    });
}

const seconds = (from, to) => (Date.parse(to) - Date.parse(from)) / 1000;

test("the clock follows a hard-mode activity from launch to finish", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId } = await createActivity();
    const starter = makeStarter();
    const start = expectedPhaseNumber =>
        starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber });

    // Launched, no phase yet.
    const before = await readClock(sessionId);
    assert.deepEqual({ ...before, serverNow: undefined }, {
        sessionId,
        timeMode:    "hard",
        finished:    false,
        phaseId:     null,
        phaseNumber: null,
        startedAt:   null,
        endsAt:      null,
        isLastPhase: null,
        serverNow:   undefined,
    });
    const [{ now }] = await query("SELECT now() AS now;");
    assert.ok(Math.abs(seconds(before.serverNow, now.toISOString())) < 5);

    // Phase 1, five minutes from its start.
    const first = await start(0);
    const timed = await readClock(sessionId);
    assert.equal(timed.phaseId, first.phase.id);
    assert.equal(timed.phaseNumber, 1);
    assert.equal(timed.isLastPhase, false);
    assert.equal(seconds(timed.startedAt, timed.endsAt), 300);
    assert.ok(seconds(timed.startedAt, timed.serverNow) >= 0);

    // Phase 2 has no duration: no deadline.
    const second = await start(1);
    const untimed = await readClock(sessionId);
    assert.equal(untimed.phaseId, second.phase.id);
    assert.equal(untimed.endsAt, null);
    assert.notEqual(untimed.startedAt, null);
    assert.equal(untimed.isLastPhase, false);

    // Phase 3, the last one, ten minutes.
    const third = await start(2);
    const last = await readClock(sessionId);
    assert.equal(last.phaseId, third.phase.id);
    assert.equal(last.isLastPhase, true);
    assert.equal(seconds(last.startedAt, last.endsAt), 600);

    // Finished as the finish helper leaves it: no current phase.
    await query("UPDATE sessions SET status = $1, current_stage = NULL WHERE id = $2;",
        [FINISHED, sessionId]);
    const finished = await readClock(sessionId);
    assert.equal(finished.finished, true);
    assert.equal(finished.timeMode, "hard");
    assert.deepEqual(
        [finished.phaseId, finished.phaseNumber, finished.startedAt, finished.endsAt,
            finished.isLastPhase],
        [null, null, null, null, null]
    );
});

test("an activity without a time mode has no deadline", { skip: SKIP_REASON }, async () => {
    const { teacherId, sessionId } = await createActivity({ timeMode: "none" });
    await makeStarter().startNextPhase({ sessionId, teacherId, expectedPhaseNumber: 0 });

    const clock = await readClock(sessionId);

    assert.equal(clock.timeMode, "none");
    assert.equal(clock.phaseNumber, 1);
    assert.notEqual(clock.startedAt, null);
    assert.equal(clock.endsAt, null);
});

test("a design's phase count decides the last phase, and none counts as zero", {
    skip: SKIP_REASON,
}, async () => {
    const { sessionId: withoutDesign } = await createActivity({ launched: false });
    assert.equal((await readClock(withoutDesign)).isLastPhase, null);

    // A phase forced onto a session whose design has no phases array.
    const { sessionId } = await createActivity({ design: { type: "semantic_differential" } });
    const [{ id: phaseId }] = await query(`
        INSERT INTO stages (number, type, sesid, started_at, start_trigger)
        VALUES (1, 'individual', $1, now(), 'teacher')
        RETURNING id;
    `, [sessionId]);
    await query("UPDATE sessions SET status = 2, current_stage = $1 WHERE id = $2;",
        [phaseId, sessionId]);

    const clock = await readClock(sessionId);
    assert.equal(clock.phaseId, Number(phaseId));
    assert.equal(clock.isLastPhase, true);

    assert.equal(await readClock(2147483647), null);
});

test("the server's time is the database's clock when the row is read", {
    skip: SKIP_REASON,
}, async () => {
    const { sessionId } = await createActivity();
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        const { rows: [{ now }] } = await client.query("SELECT now() AS now;");
        await delay(200);
        const { rows: [row] } = await client.query(PHASE_CLOCK_SQL, [sessionId]);
        await client.query("ROLLBACK");

        // now() would still be the transaction's start.
        assert.ok(row.server_now.getTime() - now.getTime() >= 150);
    } finally {
        client.release();
    }
});

test("a phase start announces the clock it committed", { skip: SKIP_REASON }, async () => {
    const { teacherId, sessionId } = await createActivity({ timeMode: "soft" });
    const emitted = [];
    const recorder = (audience, event) => (id, payload) =>
        emitted.push([audience, event, id, payload]);
    const record = audience => ({
        phaseTransition: recorder(audience, "onPhaseTransition"),
        phaseClock:      recorder(audience, "onPhaseClock"),
    });
    const notifier = createPhaseClockNotifier({
        students: () => record("students"),
        teachers: () => record("teachers"),
        readClock,
        logger:   { error() {} },
    });
    const starter = makeStarter({
        notifyPhaseStarted: (id, transition) => notifier.phaseStarted(id, transition),
    });

    const result = await starter.startNextPhase({ sessionId, teacherId, expectedPhaseNumber: 0 });

    const transition = { sessionId, phaseId: result.phase.id, phaseNumber: 1, reason: "teacher" };
    assert.deepEqual(emitted.slice(0, 2), [
        ["students", "onPhaseTransition", sessionId, transition],
        ["teachers", "onPhaseTransition", sessionId, transition],
    ]);
    const [[, , , studentClock], [, , , teacherClock]] = emitted.slice(2);
    assert.deepEqual(emitted.slice(2).map(entry => entry.slice(0, 3)), [
        ["students", "onPhaseClock", sessionId],
        ["teachers", "onPhaseClock", sessionId],
    ]);
    assert.deepEqual(studentClock, teacherClock);
    assert.equal(studentClock.timeMode, "soft");
    assert.equal(studentClock.phaseId, result.phase.id);
    assert.equal(seconds(studentClock.startedAt, studentClock.endsAt), 300);
});

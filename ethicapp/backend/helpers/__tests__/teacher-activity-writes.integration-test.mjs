// Integration tests for the statements with which a teacher creates a session
// and moves it to a phase (#877), against a real PostgreSQL database with
// migrations V1-V32 applied. Each test plays the management console's
// forgetting of the teacher as it locks the account: FOR UPDATE, the last
// count of open activities, then the anonymization and the commit. A write
// requested after that count must wait and then write nothing; lock waits
// cannot be checked with fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert users and sessions of their own.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import pg from "pg";

import { CREATE_SESSION_SQL, TRANSITION_SESSION_SQL } from "../teacher-activity-writes.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

const IN_PROGRESS = 2;
const FINISHED = 3;

// The console's count (management-console/backend/helpers/teacher-materials-helper.js).
const OPEN_ACTIVITIES_COUNT_SQL = `
    SELECT count(*)::integer AS open_activities
    FROM sessions s
    WHERE s.creator = $1
      AND (
          s.status IS DISTINCT FROM ${FINISHED}
          OR EXISTS (SELECT 1 FROM activity_finalizations f WHERE f.session_id = s.id)
      )
`;

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
    return pool;
}

async function query(sql, params = []) {
    return (await getPool().query(sql, params)).rows;
}

test.after(async () => {
    await pool?.end();
});

async function insertTeacher() {
    const suffix = randomUUID();
    const [user] = await query(`
        INSERT INTO users (name, rut, mail, role)
        VALUES ('Integration teacher', $1, $2, 'P')
        RETURNING id;
    `, [suffix, `${suffix}@integration.test`]);
    return Number(user.id);
}

// A finished activity with one phase, as ethicapp leaves it once it finished
// the teacher's activities before forgetting.
async function insertFinishedSession(teacherId) {
    const [session] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type)
        VALUES ('Integration session', '', $1, now(), $2, 'T')
        RETURNING id;
    `, [teacherId, FINISHED]);
    const [phase] = await query(
        "INSERT INTO stages (number, type, sesid) VALUES (1, 'team', $1) RETURNING id;",
        [session.id]
    );
    return { sessionId: Number(session.id), phaseId: Number(phase.id) };
}

async function sessionStatus(sessionId) {
    const [row] = await query("SELECT status, current_stage FROM sessions WHERE id = $1;", [sessionId]);
    return { status: Number(row.status), currentStage: row.current_stage === null ? null : Number(row.current_stage) };
}

async function waitUntilBlockedOnLock(pid) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const [row] = await query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1;", [pid]);
        if (row?.wait_event_type === "Lock") {
            return;
        }
        await delay(50);
    }
    throw new Error(`Backend ${pid} never waited on a lock.`);
}

// The console's forgetting, up to its last count: the account locked and no
// open activity left. It resolves to the client inside that transaction.
async function forgettingAfterLastCount(teacherId) {
    const client = await getPool().connect();
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE;", [teacherId]);
    const [{ open_activities: open }] = (await client.query(OPEN_ACTIVITIES_COUNT_SQL, [teacherId])).rows;
    assert.equal(open, 0, "nothing is open when forgetting counts");
    return client;
}

async function commitForgetting(client, teacherId) {
    try {
        await client.query(
            "UPDATE users SET anonymized_at = now(), active = false WHERE id = $1;",
            [teacherId]
        );
        await client.query("COMMIT");
    } finally {
        client.release();
    }
}

// Starts the statement on a connection of its own and resolves once it waits
// on a lock, to { done }, the statement's result. (Resolving to the result
// itself would wait for the statement to finish.)
async function startBlocked(sql, params) {
    const client = await getPool().connect();
    const [{ pid }] = (await client.query("SELECT pg_backend_pid() AS pid;")).rows;
    const done = client.query(sql, params).finally(() => client.release());
    await waitUntilBlockedOnLock(pid);
    return { done };
}

test("a phase transition requested after forgetting's last count waits and reopens nothing", {
    skip: SKIP_REASON,
}, async () => {
    const teacherId = await insertTeacher();
    const { sessionId, phaseId } = await insertFinishedSession(teacherId);

    const forgetting = await forgettingAfterLastCount(teacherId);
    // The teacher's request was authorized before forgetting started.
    const transition = await startBlocked(TRANSITION_SESSION_SQL, [IN_PROGRESS, phaseId, sessionId, teacherId]);
    await commitForgetting(forgetting, teacherId);

    assert.equal((await transition.done).rowCount, 0);
    assert.deepEqual(await sessionStatus(sessionId), { status: FINISHED, currentStage: null });
    const [{ open_activities: open }] = await query(OPEN_ACTIVITIES_COUNT_SQL, [teacherId]);
    assert.equal(open, 0, "the forgotten teacher has no open activity");
});

test("a session requested after forgetting's last count waits and is not created", {
    skip: SKIP_REASON,
}, async () => {
    const teacherId = await insertTeacher();

    const forgetting = await forgettingAfterLastCount(teacherId);
    const creation = await startBlocked(CREATE_SESSION_SQL, ["Late session", "", teacherId, "T"]);
    await commitForgetting(forgetting, teacherId);

    assert.equal((await creation.done).rowCount, 0);
    const [{ sessions }] = await query("SELECT count(*)::integer AS sessions FROM sessions WHERE creator = $1;", [teacherId]);
    assert.equal(sessions, 0);
});

test("a transition committed before forgetting locks the account is seen by its count", {
    skip: SKIP_REASON,
}, async () => {
    const teacherId = await insertTeacher();
    const { sessionId, phaseId } = await insertFinishedSession(teacherId);

    const moved = await query(TRANSITION_SESSION_SQL, [IN_PROGRESS, phaseId, sessionId, teacherId]);
    assert.equal(moved.length, 1);

    // Forgetting counts one open activity, so it refuses (OPEN_ACTIVITIES).
    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE;", [teacherId]);
        const [{ open_activities: open }] = (await client.query(OPEN_ACTIVITIES_COUNT_SQL, [teacherId])).rows;
        assert.equal(open, 1);
        await client.query("ROLLBACK");
    } finally {
        client.release();
    }
});

test("only the session's teacher, with an account not anonymized, creates and moves sessions", {
    skip: SKIP_REASON,
}, async () => {
    const teacherId = await insertTeacher();
    const otherTeacherId = await insertTeacher();

    const [created] = await query(CREATE_SESSION_SQL, ["Integration session", "", teacherId, "T"]);
    assert.ok(Number(created.id) > 0);
    const [session] = await query(
        "SELECT creator, status, type FROM sessions WHERE id = $1;",
        [created.id]
    );
    assert.deepEqual(
        { creator: Number(session.creator), status: Number(session.status), type: session.type },
        { creator: teacherId, status: 1, type: "T" }
    );

    const { sessionId, phaseId } = await insertFinishedSession(teacherId);
    assert.equal((await query(TRANSITION_SESSION_SQL, [IN_PROGRESS, phaseId, sessionId, otherTeacherId])).length, 0);
    assert.equal((await sessionStatus(sessionId)).status, FINISHED);
    assert.equal((await query(TRANSITION_SESSION_SQL, [IN_PROGRESS, phaseId, sessionId, teacherId])).length, 1);
    assert.deepEqual(await sessionStatus(sessionId), { status: IN_PROGRESS, currentStage: phaseId });

    await query("UPDATE users SET anonymized_at = now() WHERE id = $1;", [teacherId]);
    assert.equal((await query(CREATE_SESSION_SQL, ["After", "", teacherId, "T"])).length, 0);
    assert.equal((await query(TRANSITION_SESSION_SQL, [IN_PROGRESS, phaseId, sessionId, teacherId])).length, 0);
});

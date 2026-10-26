// Integration tests for the activity launch transaction and the AI service
// policy pin, against a real PostgreSQL database with migrations V1-V22
// applied. Snapshot and lock behavior cannot be checked with fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert users, designs, sessions and
// policy versions; versions are append-only and are never removed.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import pg from "pg";

import { launchActivity } from "../activity-launch-helper.js";
import { pinSessionPolicy } from "../ai-service-policy.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

if (SKIP_REASON) {
    console.warn(SKIP_REASON);
}

let pool = null;

async function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
    return pool;
}

async function query(sql, params = []) {
    const db = await getPool();
    return (await db.query(sql, params)).rows;
}

async function createFixture() {
    const suffix = randomUUID();
    const [user] = await query(`
        INSERT INTO users (name, rut, mail, role)
        VALUES ('Integration teacher', $1, $2, 'P')
        RETURNING id;
    `, [suffix, `${suffix}@integration.test`]);
    const [design] = await query(`
        INSERT INTO designs (creator, design)
        VALUES ($1, '{}'::jsonb)
        RETURNING id;
    `, [user.id]);
    const [session] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type)
        VALUES ('Integration session', '', $1, now(), 1, 'R')
        RETURNING id;
    `, [user.id]);
    return { userId: user.id, designId: design.id, sessionId: session.id };
}

async function insertPolicyVersion(note) {
    const [row] = await query(`
        INSERT INTO ai_service_policy_versions (allowed_service_ids, note)
        VALUES ('{}', $1)
        RETURNING id;
    `, [note]);
    return Number(row.id);
}

async function sessionState(sessionId) {
    const [row] = await query(`
        SELECT ai_service_policy_version_id AS pin,
               code,
               (SELECT count(*) FROM activity WHERE activity.session = sessions.id) AS activities
        FROM sessions
        WHERE id = $1;
    `, [sessionId]);
    return { pin: Number(row.pin), code: row.code, activities: Number(row.activities) };
}

async function connect() {
    return (await getPool()).connect();
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

test.after(async () => {
    await pool?.end();
});

test("a launch pins the current version; a relaunch keeps it", { skip: SKIP_REASON }, async () => {
    const { designId, sessionId } = await createFixture();
    const current = await insertPolicyVersion("integration: current at launch");

    const first = await launchActivity({ sessionId, designId, sessionCode: "INT001" }, {
        connect,
    });
    assert.equal(first.policyVersionId, current);

    await insertPolicyVersion("integration: saved after launch");
    const second = await launchActivity({ sessionId, designId, sessionCode: "INT002" }, {
        connect,
    });

    assert.equal(second.policyVersionId, current);
    assert.deepEqual(await sessionState(sessionId), {
        pin:        current,
        code:       "INT001",
        activities: 2,
    });
});

test("a failed launch rolls back the pin, the code and the activity", {
    skip: SKIP_REASON,
}, async () => {
    const { sessionId } = await createFixture();
    const before = await sessionState(sessionId);
    await insertPolicyVersion("integration: newer than the session");

    await assert.rejects(launchActivity(
        { sessionId, designId: -1, sessionCode: "INT003" },
        { connect }
    ));

    assert.deepEqual(await sessionState(sessionId), before);
});

test("a concurrent launch keeps the pin of the launch that committed first", {
    skip: SKIP_REASON,
}, async () => {
    const { designId, sessionId } = await createFixture();
    const pinnedByA = await insertPolicyVersion("integration: pinned by launch A");

    // Launch A pins the session and holds its transaction open.
    const clientA = await connect();
    try {
        await clientA.query("BEGIN");
        assert.equal(await pinSessionPolicy(clientA, sessionId), pinnedByA);

        // A newer policy is committed while A is still open.
        const newer = await insertPolicyVersion("integration: saved during launch A");
        assert.ok(newer > pinnedByA);

        // Launch B starts and must wait for A's lock on the session.
        const clientB = await connect();
        const [{ pid }] = (await clientB.query("SELECT pg_backend_pid() AS pid;")).rows;
        const launchB = launchActivity(
            { sessionId, designId, sessionCode: "INT005" },
            { connect: async () => clientB }
        );
        await waitUntilBlockedOnLock(pid);

        // A finishes its launch.
        await clientA.query("UPDATE sessions SET code = $1 WHERE id = $2;", ["INT004", sessionId]);
        await clientA.query("INSERT INTO activity (design, session) VALUES ($1, $2);", [
            designId,
            sessionId,
        ]);
        await clientA.query("COMMIT");

        const resultB = await launchB;
        assert.equal(resultB.policyVersionId, pinnedByA);
        assert.equal((await sessionState(sessionId)).pin, pinnedByA);
    } catch (error) {
        await clientA.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        clientA.release();
    }
});

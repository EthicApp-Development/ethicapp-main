// Integration test for the student activity descriptor query, against a real
// PostgreSQL database with migrations applied. Finishing an activity clears
// sessions.current_stage, which only real join semantics show.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The test inserts a user, a design, a session and
// its phases, and does not remove them.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { STUDENT_ACTIVITY_DESCRIPTOR_SQL } from "../student-activity-descriptor.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

if (SKIP_REASON) {
    console.warn(SKIP_REASON);
}

let pool = null;

async function query(sql, params = []) {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    return (await pool.query(sql, params)).rows;
}

async function createActivity() {
    const suffix = randomUUID();
    const [user] = await query(`
        INSERT INTO users (name, rut, mail, role)
        VALUES ('Integration teacher', $1, $2, 'P')
        RETURNING id;
    `, [suffix, `${suffix}@integration.test`]);
    const [design] = await query(`
        INSERT INTO designs (creator, design)
        VALUES ($1, '{"phases": [{}, {}]}'::jsonb)
        RETURNING id;
    `, [user.id]);
    const [session] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type)
        VALUES ('Integration session', 'Integration description', $1, now(), 2, 'R')
        RETURNING id;
    `, [user.id]);
    await query("INSERT INTO activity (design, session) VALUES ($1, $2);", [design.id, session.id]);
    const phases = await query(`
        INSERT INTO stages (number, type, sesid)
        VALUES (1, 'individual', $1), (2, 'team', $1)
        RETURNING id, number;
    `, [session.id]);
    return { sessionId: session.id, phases };
}

test.after(async () => {
    await pool?.end();
});

test("the descriptor of an activity in progress names its current phase", {
    skip: SKIP_REASON,
}, async () => {
    const { sessionId, phases } = await createActivity();
    const second = phases.find((phase) => phase.number === 2);
    await query("UPDATE sessions SET current_stage = $1 WHERE id = $2;", [second.id, sessionId]);

    const rows = await query(STUDENT_ACTIVITY_DESCRIPTOR_SQL, [sessionId]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].description, "Integration description");
    assert.deepEqual(rows[0].design, { phases: [{}, {}] });
    assert.equal(rows[0].currentphaseid, second.id);
    assert.equal(rows[0].currentphasenumber, 2);
});

test("the descriptor of a finished activity has its design and no current phase", {
    skip: SKIP_REASON,
}, async () => {
    const { sessionId, phases } = await createActivity();
    await query("UPDATE sessions SET current_stage = $1 WHERE id = $2;", [phases[0].id, sessionId]);
    // As POST /activities/:session_id/finish does.
    await query("UPDATE sessions SET status = 3, current_stage = NULL WHERE id = $1;", [sessionId]);

    const rows = await query(STUDENT_ACTIVITY_DESCRIPTOR_SQL, [sessionId]);

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].design, { phases: [{}, {}] });
    assert.equal(rows[0].currentphaseid, null);
    assert.equal(rows[0].currentphasenumber, null);
});

test("a session without an activity has no descriptor", { skip: SKIP_REASON }, async () => {
    const [user] = await query(`
        INSERT INTO users (name, rut, mail, role)
        VALUES ('Integration teacher', $1, $2, 'P')
        RETURNING id;
    `, [randomUUID(), `${randomUUID()}@integration.test`]);
    const [session] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type)
        VALUES ('Integration session', '', $1, now(), 1, 'R')
        RETURNING id;
    `, [user.id]);

    assert.deepEqual(await query(STUDENT_ACTIVITY_DESCRIPTOR_SQL, [session.id]), []);
});

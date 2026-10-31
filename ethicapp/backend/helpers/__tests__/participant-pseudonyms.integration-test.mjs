// Integration tests for the students' pseudonym numbers (#897), against a
// real PostgreSQL database with migrations V1-V34 applied: the constraints of
// activity_participant_pseudonyms (V34), the assignment's statements, unique
// numbers under concurrent requests (two dashboard tabs), a late joiner, the
// cascade when a session or an account is deleted, and the owner check of
// the phase groups endpoint. Concurrent inserts on the unique keys cannot be
// checked with fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert users and sessions of their own,
// which are not removed (except those the cascade tests delete).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import {
    INSERT_PSEUDONYM_SQL,
    SESSION_PSEUDONYMS_SQL,
    createPseudonymAssigner,
} from "../participant-pseudonyms-helper.js";
import { PHASE_OWNERSHIP_SQL } from "../activity-owner-helper.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
    return pool;
}

async function query(sql, params = []) {
    return (await getPool().query(sql, params)).rows;
}

test.after(async () => {
    await pool?.end();
});

async function insertUser(role) {
    const suffix = randomUUID();
    const [user] = await query(`
        INSERT INTO users (name, rut, mail, role)
        VALUES ('Integration user', $1, $2, $3)
        RETURNING id;
    `, [suffix, `${suffix}@integration.test`, role]);
    return Number(user.id);
}

async function joinSession(sessionId, userId) {
    await query("INSERT INTO sesusers (sesid, uid) VALUES ($1, $2);", [sessionId, userId]);
}

// A session of a new teacher, who is a member as POST /sessions makes them,
// with `studentCount` students who joined in order.
async function createSession({ studentCount = 5 } = {}) {
    const teacherId = await insertUser("P");
    const [{ id }] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type)
        VALUES ('Integration session', '', $1, now(), 2, 'T')
        RETURNING id;
    `, [teacherId]);
    const sessionId = Number(id);
    await joinSession(sessionId, teacherId);

    const studentIds = [];
    for (let i = 0; i < studentCount; i += 1) {
        const studentId = await insertUser("A");
        await joinSession(sessionId, studentId);
        studentIds.push(studentId);
    }
    return { teacherId, sessionId, studentIds };
}

async function storedNumbers(sessionId) {
    const rows = await query(`
        SELECT user_id, number
        FROM activity_participant_pseudonyms
        WHERE session_id = $1
        ORDER BY number;
    `, [sessionId]);
    return rows.map((row) => ({ userId: Number(row.user_id), number: Number(row.number) }));
}

function assertUniqueNumbers(entries, studentIds, rangeEnd) {
    assert.deepEqual(entries.map((entry) => entry.userId).sort((a, b) => a - b),
        [...studentIds].sort((a, b) => a - b));
    const numbers = entries.map((entry) => entry.number);
    assert.equal(new Set(numbers).size, numbers.length);
    assert.ok(numbers.every((number) => number >= 1 && number <= rangeEnd), numbers.join(","));
}

async function expectPgError(promise, code) {
    await assert.rejects(promise, (error) => {
        assert.equal(error.code, code, error.message);
        return true;
    });
}

test("the table refuses a second number for a student, a number taken twice and a number below 1", {
    skip: SKIP_REASON,
}, async () => {
    const { sessionId, studentIds: [first, second] } = await createSession({ studentCount: 2 });
    const insert = (userId, number, session = sessionId) => query(`
        INSERT INTO activity_participant_pseudonyms (session_id, user_id, number)
        VALUES ($1, $2, $3);
    `, [session, userId, number]);

    await insert(first, 12);
    await expectPgError(insert(first, 13), "23505");
    await expectPgError(insert(second, 12), "23505");
    await expectPgError(insert(second, 0), "23514");
    await expectPgError(insert(second, 14, 2147483000), "23503");

    // The same number in another session is free.
    const other = await createSession({ studentCount: 1 });
    await insert(other.studentIds[0], 12, other.sessionId);

    const [constraint] = await query(`
        SELECT array_agg(confdeltype::text ORDER BY confrelid::regclass::text) AS rules
        FROM pg_constraint
        WHERE conrelid = 'activity_participant_pseudonyms'::regclass
          AND contype = 'f';
    `);
    assert.deepEqual(constraint.rules, ["c", "c"], "both foreign keys cascade");
});

test("every student of the session gets a unique number in 1-99; the teacher none", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId, studentIds } = await createSession({ studentCount: 6 });
    const assigner = createPseudonymAssigner({ query });

    const result = await assigner.assignParticipantPseudonyms(sessionId);

    assertUniqueNumbers(result, studentIds, 99);
    assert.deepEqual(result, await storedNumbers(sessionId));
    assert.ok(!result.some((entry) => entry.userId === teacherId));

    // Asking again changes nothing.
    assert.deepEqual(await assigner.assignParticipantPseudonyms(sessionId), result);
});

test("a late joiner gets a new number and nobody else's changes", {
    skip: SKIP_REASON,
}, async () => {
    const { sessionId, studentIds } = await createSession({ studentCount: 4 });
    const assigner = createPseudonymAssigner({ query });
    const before = await assigner.assignParticipantPseudonyms(sessionId);

    const lateId = await insertUser("A");
    await joinSession(sessionId, lateId);
    const after = await assigner.assignParticipantPseudonyms(sessionId);

    assertUniqueNumbers(after, [...studentIds, lateId], 99);
    for (const { userId, number } of before) {
        assert.equal(after.find((entry) => entry.userId === userId).number, number);
    }
    const lateNumber = after.find((entry) => entry.userId === lateId).number;
    assert.ok(!before.some((entry) => entry.number === lateNumber));
});

test("a class of 51 draws from 1-999", { skip: SKIP_REASON }, async () => {
    const { sessionId, studentIds } = await createSession({ studentCount: 51 });

    const result = await createPseudonymAssigner({ query }).assignParticipantPseudonyms(sessionId);

    assertUniqueNumbers(result, studentIds, 999);
    // All 51 below 100 has a probability of about 1e-51.
    assert.ok(result.at(-1).number > 99);
});

test("concurrent requests assign one unique number per student", {
    skip: SKIP_REASON,
}, async () => {
    const { sessionId, studentIds } = await createSession({ studentCount: 30 });

    const results = await Promise.all(Array.from({ length: 8 }, () => (
        createPseudonymAssigner({ query }).assignParticipantPseudonyms(sessionId)
    )));

    const stored = await storedNumbers(sessionId);
    assertUniqueNumbers(stored, studentIds, 99);
    for (const result of results) {
        assert.deepEqual(result, stored);
    }
});

test("two tabs that draw the same numbers retry their collisions and agree", {
    skip: SKIP_REASON,
}, async () => {
    const { sessionId, studentIds } = await createSession({ studentCount: 20 });

    // Both tabs read the empty session before either inserts, and both draw
    // the first free numbers, so every insert of one collides with the
    // other's.
    let reads = 0;
    let releaseReads;
    const bothRead = new Promise((resolve) => {
        releaseReads = resolve;
    });
    let lostInserts = 0;

    function tab() {
        let firstRead = true;
        return createPseudonymAssigner({
            randomInt: () => 0,
            query:     async (sql, params) => {
                const rows = await query(sql, params);
                if (sql === SESSION_PSEUDONYMS_SQL && firstRead) {
                    firstRead = false;
                    reads += 1;
                    if (reads === 2) {
                        releaseReads();
                    }
                    await bothRead;
                }
                if (sql === INSERT_PSEUDONYM_SQL && rows.length === 0) {
                    lostInserts += 1;
                }
                return rows;
            },
        });
    }

    const [first, second] = await Promise.all([
        tab().assignParticipantPseudonyms(sessionId),
        tab().assignParticipantPseudonyms(sessionId),
    ]);

    const stored = await storedNumbers(sessionId);
    assertUniqueNumbers(stored, studentIds, 99);
    assert.deepEqual(first, stored);
    assert.deepEqual(second, stored);
    assert.ok(lostInserts > 0, "some inserts collided");
});

test("deleting a session or an account deletes their numbers", { skip: SKIP_REASON }, async () => {
    const { sessionId, studentIds } = await createSession({ studentCount: 3 });
    await createPseudonymAssigner({ query }).assignParticipantPseudonyms(sessionId);
    assert.equal((await storedNumbers(sessionId)).length, 3);

    // An account: its memberships must go first (sesusers has no cascade).
    const [leaving] = studentIds;
    await query("DELETE FROM sesusers WHERE sesid = $1 AND uid = $2;", [sessionId, leaving]);
    await query("DELETE FROM users WHERE id = $1;", [leaving]);
    assert.deepEqual((await storedNumbers(sessionId)).map((entry) => entry.userId).sort(),
        studentIds.slice(1).sort());

    // The session.
    await query("DELETE FROM sesusers WHERE sesid = $1;", [sessionId]);
    await query("DELETE FROM sessions WHERE id = $1;", [sessionId]);
    assert.deepEqual(await storedNumbers(sessionId), []);
    const [{ count }] = await query(`
        SELECT count(*)::integer AS count
        FROM activity_participant_pseudonyms
        WHERE user_id = ANY($1);
    `, [studentIds]);
    assert.equal(count, 0);
});

test("only the owner, with an account not anonymized, owns a phase", {
    skip: SKIP_REASON,
}, async () => {
    const { teacherId, sessionId } = await createSession({ studentCount: 0 });
    const otherTeacherId = await insertUser("P");
    const [{ id }] = await query(
        "INSERT INTO stages (number, type, sesid) VALUES (1, 'team', $1) RETURNING id;",
        [sessionId]
    );
    const phaseId = Number(id);
    const ownership = (requester, phase = phaseId) => (
        query(PHASE_OWNERSHIP_SQL, [phase, requester])
    );

    assert.deepEqual(await ownership(teacherId), [
        { phase_id: phaseId, session_id: sessionId, owned: true },
    ]);
    assert.equal((await ownership(otherTeacherId))[0].owned, false);
    assert.deepEqual(await ownership(teacherId, 2147483000), []);

    await query("UPDATE users SET anonymized_at = now() WHERE id = $1;", [teacherId]);
    assert.equal((await ownership(teacherId))[0].owned, false);
});

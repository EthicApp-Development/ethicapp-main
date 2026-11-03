// Integration tests for the usage counts of a case (#1011, epic #1008),
// against a real PostgreSQL database with migrations applied: the aggregate
// over a case's designs and their activities cannot be checked with fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { caseUsageJsonSql, normalizeCaseUsage } from "../case-usage.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    return pool;
}

const query = async (sql, params = []) => (await getPool().query(sql, params)).rows;

test.after(async () => {
    await pool?.end();
});

async function createTeacher() {
    const suffix = randomUUID();
    const [user] = await query(`
        INSERT INTO users (name, rut, mail, role)
        VALUES ('Integration teacher', $1, $2, 'P')
        RETURNING id;
    `, [suffix, `${suffix}@integration.test`]);
    return user.id;
}

async function createCase(creator) {
    const [row] = await query(`
        INSERT INTO ethical_cases
            (title, author_firstname, author_lastname, author_email, pdf_path, creator)
        VALUES ('Integration case', 'Ada', 'Lovelace', 'ada@integration.test',
                '/uploads/cases/0/case.pdf', $1)
        RETURNING id;
    `, [creator]);
    return row.id;
}

async function createDesign(creator, caseId, { archived = false } = {}) {
    const [row] = await query(`
        INSERT INTO designs (creator, design, case_id, archived)
        VALUES ($1, '{}'::jsonb, $2, $3)
        RETURNING id;
    `, [creator, caseId, archived]);
    return row.id;
}

async function launchActivity(designId, teacherId) {
    const [session] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type)
        VALUES ('Integration session', '', $1, now(), 1, 'R')
        RETURNING id;
    `, [teacherId]);
    await query("INSERT INTO activity (design, session) VALUES ($1, $2);", [designId, session.id]);
}

// The usage of each case as GET /cases selects it for `teacherId`.
async function usageOf(teacherId, caseId) {
    const [row] = await query(`
        SELECT ${caseUsageJsonSql("c", "$1")} AS case_usage
        FROM ethical_cases c
        WHERE c.id = $2;
    `, [teacherId, caseId]);
    return normalizeCaseUsage(row.case_usage);
}

test("case usage: a case no design uses has only zeros", { skip: SKIP_REASON }, async () => {
    const teacher = await createTeacher();
    const caseId = await createCase(teacher);

    assert.deepEqual(await usageOf(teacher, caseId), {
        activityCount:     0,
        ownDesignCount:    0,
        otherDesignCount:  0,
        otherTeacherCount: 0,
    });
});

test("case usage: the teacher's own designs, archived ones included", {
    skip: SKIP_REASON,
}, async () => {
    const teacher = await createTeacher();
    const caseId = await createCase(teacher);
    const otherCaseId = await createCase(teacher);
    await createDesign(teacher, caseId);
    await createDesign(teacher, caseId, { archived: true });
    // A design of another case counts for that case only.
    await createDesign(teacher, otherCaseId);

    assert.deepEqual(await usageOf(teacher, caseId), {
        activityCount:     0,
        ownDesignCount:    2,
        otherDesignCount:  0,
        otherTeacherCount: 0,
    });
});

test("case usage: other teachers' designs, archived ones included, and their teachers", {
    skip: SKIP_REASON,
}, async () => {
    const author = await createTeacher();
    const colleague = await createTeacher();
    const anotherColleague = await createTeacher();
    const caseId = await createCase(author);
    await createDesign(author, caseId);
    await createDesign(colleague, caseId);
    await createDesign(colleague, caseId, { archived: true });
    await createDesign(anotherColleague, caseId, { archived: true });

    assert.deepEqual(await usageOf(author, caseId), {
        activityCount:     0,
        ownDesignCount:    1,
        otherDesignCount:  3,
        otherTeacherCount: 2,
    });
});

test("case usage: the activities launched from any design that uses the case", {
    skip: SKIP_REASON,
}, async () => {
    const author = await createTeacher();
    const colleague = await createTeacher();
    const caseId = await createCase(author);
    const ownDesign = await createDesign(author, caseId);
    const archivedOwnDesign = await createDesign(author, caseId, { archived: true });
    const colleagueDesign = await createDesign(colleague, caseId);
    await launchActivity(ownDesign, author);
    await launchActivity(ownDesign, author);
    await launchActivity(archivedOwnDesign, author);
    await launchActivity(colleagueDesign, colleague);

    // Each design is counted once, however many activities it has.
    assert.deepEqual(await usageOf(author, caseId), {
        activityCount:     4,
        ownDesignCount:    2,
        otherDesignCount:  1,
        otherTeacherCount: 1,
    });
});

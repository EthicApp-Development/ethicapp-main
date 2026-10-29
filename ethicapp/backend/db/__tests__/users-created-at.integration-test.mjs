// Integration test for users.created_at (V28), against a real PostgreSQL
// database with migrations applied. New accounts get the creation time from
// the column default; accounts that existed before the migration stay NULL
// ("unknown") instead of being stamped with the time of the migration.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The first test inserts a user and does not remove
// it. The second replays the migration inside a transaction that it rolls
// back; it briefly locks the users table while doing so.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

if (SKIP_REASON) {
    console.warn(SKIP_REASON);
}

const MIGRATION_URL = new URL(
    "../../../../database/migrations/V28__users_created_at.sql",
    import.meta.url
);

// Same columns as the auth-backend sign-up insert, which leaves created_at to
// the default like every other account-creation path.
const INSERT_USER_SQL = `
    INSERT INTO users (firstname, lastname, name, rut, mail, role, active, email_confirmed)
    VALUES ('Integration', 'Student', 'Integration Student', $1, $2, 'A', false, false)
`;

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    return pool;
}

function userParams() {
    const suffix = randomUUID();
    return [suffix, `${suffix}@integration.test`];
}

test.after(async () => {
    await pool?.end();
});

test("users.created_at is a nullable timestamptz that defaults to now()", {
    skip: SKIP_REASON,
}, async () => {
    const { rows: [column] } = await getPool().query(`
        SELECT data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users'
          AND column_name = 'created_at';
    `);

    assert.deepEqual(column, {
        data_type:      "timestamp with time zone",
        is_nullable:    "YES",
        column_default: "now()",
    });
});

test("a new account gets its creation time from the default", {
    skip: SKIP_REASON,
}, async () => {
    const { rows: [before] } = await getPool().query("SELECT now() AS at;");
    const { rows: [user] } = await getPool().query(
        `${INSERT_USER_SQL} RETURNING created_at;`,
        userParams()
    );
    const { rows: [after] } = await getPool().query("SELECT now() AS at;");

    assert.ok(user.created_at instanceof Date);
    assert.ok(user.created_at >= before.at, "created_at is not earlier than the insert");
    assert.ok(user.created_at <= after.at, "created_at is not later than the insert");
});

test("the migration leaves existing accounts unknown and dates the new ones", {
    skip: SKIP_REASON,
}, async () => {
    const migrationSql = await readFile(MIGRATION_URL, "utf8");
    const client = await getPool().connect();

    try {
        await client.query("BEGIN;");
        await client.query("SET LOCAL lock_timeout = '10s';");
        // Go back to the schema before V28, inside this transaction only.
        await client.query("ALTER TABLE users DROP COLUMN created_at;");
        const { rows: [existing] } = await client.query(
            `${INSERT_USER_SQL} RETURNING id;`,
            userParams()
        );

        await client.query(migrationSql);

        const { rows: [existingAfter] } = await client.query(
            "SELECT created_at FROM users WHERE id = $1;",
            [existing.id]
        );
        const { rows: [created] } = await client.query(
            `${INSERT_USER_SQL} RETURNING created_at;`,
            userParams()
        );
        const { rows: [{ undated }] } = await client.query(
            "SELECT count(*)::int AS undated FROM users WHERE created_at IS NULL;"
        );
        const { rows: [{ accounts }] } = await client.query(
            "SELECT count(*)::int AS accounts FROM users;"
        );

        assert.equal(existingAfter.created_at, null, "an existing account is not backfilled");
        assert.ok(created.created_at instanceof Date, "an account created afterwards is dated");
        // Every account that existed before the migration stays unknown.
        assert.equal(undated, accounts - 1);
    } finally {
        await client.query("ROLLBACK;");
        client.release();
    }
});

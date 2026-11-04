// Integration test for V42 (epic #1067, sub-issue #1068), against a real
// PostgreSQL database with migrations applied: users.rut is nullable, and
// users_mail_lower_unique refuses two emails that differ only in letter case.
// Replaying the migration over accounts that collide stops it with an error
// that lists them.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The accounts the first tests insert are not
// removed. The replays run inside transactions that they roll back; they
// briefly lock the users table while doing so.

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
    "../../../../database/migrations/V42__retire_rut_and_unique_mail_ci.sql",
    import.meta.url
);

// Same columns as the auth-backend sign-up insert, without the RUT.
const INSERT_USER_SQL = `
    INSERT INTO users (firstname, lastname, name, mail, role, active, email_confirmed)
    VALUES ('Integration', 'Student', 'Integration Student', $1, 'A', false, false)
    RETURNING id, rut;
`;

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    return pool;
}

function uniqueMail() {
    return `it-1068-${randomUUID()}@integration.test`;
}

test.after(async () => {
    await pool?.end();
});

// Goes back to the schema before V42, inside the caller's transaction only.
// rut stays nullable: accounts inserted without one may exist by now, and the
// migration's ALTER COLUMN changes nothing on a nullable column.
async function restoreSchemaBeforeV42(client) {
    await client.query("SET LOCAL lock_timeout = '10s';");
    await client.query("DROP INDEX users_mail_lower_unique;");
    await client.query("ALTER TABLE users ADD CONSTRAINT users_mail_unique UNIQUE (mail);");
}

async function withRolledBackTransaction(work) {
    const client = await getPool().connect();

    try {
        await client.query("BEGIN;");
        await work(client);
    } finally {
        await client.query("ROLLBACK;");
        client.release();
    }
}

test("an account is created without a RUT", { skip: SKIP_REASON }, async () => {
    const { rows: [column] } = await getPool().query(`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users'
          AND column_name = 'rut';
    `);
    const { rows: [user] } = await getPool().query(INSERT_USER_SQL, [uniqueMail()]);

    assert.equal(column.is_nullable, "YES");
    assert.ok(user.id);
    assert.equal(user.rut, null);
});

test("two emails that differ only in letter case are refused", { skip: SKIP_REASON }, async () => {
    const mail = uniqueMail();
    await getPool().query(INSERT_USER_SQL, [mail]);

    for (const duplicate of [mail.toUpperCase(), `I${mail.slice(1)}`, mail]) {
        await assert.rejects(
            getPool().query(INSERT_USER_SQL, [duplicate]),
            (error) => {
                assert.equal(error.code, "23505", duplicate);
                assert.equal(error.constraint, "users_mail_lower_unique", duplicate);
                return true;
            }
        );
    }
});

test("changing an email to another account's, in another case, is refused", {
    skip: SKIP_REASON,
}, async () => {
    const taken = uniqueMail();
    await getPool().query(INSERT_USER_SQL, [taken]);
    const { rows: [other] } = await getPool().query(INSERT_USER_SQL, [uniqueMail()]);

    await assert.rejects(
        getPool().query(
            "UPDATE users SET mail = $1 WHERE id = $2;",
            [taken.toUpperCase(), other.id]
        ),
        { code: "23505", constraint: "users_mail_lower_unique" }
    );
});

test("the case-insensitive index replaces the case-sensitive constraint", {
    skip: SKIP_REASON,
}, async () => {
    const { rows: [index] } = await getPool().query(`
        SELECT indisunique, pg_get_indexdef(indexrelid) AS definition
        FROM pg_index
        WHERE indexrelid = 'users_mail_lower_unique'::regclass;
    `);
    const { rows: constraints } = await getPool().query(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND conname = 'users_mail_unique';
    `);

    assert.equal(index.indisunique, true);
    assert.match(index.definition, /\(lower\(mail\)\)/);
    assert.deepEqual(constraints, []);
});

test("the migration stops, listing the accounts, when emails collide", {
    skip: SKIP_REASON,
}, async () => {
    const migrationSql = await readFile(MIGRATION_URL, "utf8");
    const mail = uniqueMail();

    await withRolledBackTransaction(async (client) => {
        await restoreSchemaBeforeV42(client);
        const { rows: [first] } = await client.query(INSERT_USER_SQL, [mail]);
        const { rows: [second] } = await client.query(INSERT_USER_SQL, [mail.toUpperCase()]);

        await assert.rejects(client.query(migrationSql), (error) => {
            assert.equal(error.code, "P0001");
            assert.match(error.message, /differ only in letter case/);
            assert.ok(
                error.message.includes(`${mail} (users ${first.id}, ${second.id})`),
                error.message
            );
            assert.match(error.hint, /Case-Insensitive Emails/);
            return true;
        });
    });
});

test("the migration adds the index and drops the old constraint", {
    skip: SKIP_REASON,
}, async () => {
    const migrationSql = await readFile(MIGRATION_URL, "utf8");

    await withRolledBackTransaction(async (client) => {
        await restoreSchemaBeforeV42(client);
        await client.query(INSERT_USER_SQL, [uniqueMail()]);

        await client.query(migrationSql);

        const { rows } = await client.query(`
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'users'
              AND indexname IN ('users_mail_lower_unique', 'users_mail_unique');
        `);

        assert.deepEqual(rows.map((row) => row.indexname), ["users_mail_lower_unique"]);
    });
});

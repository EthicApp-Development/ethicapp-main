// Integration test for the phase clock columns (V45, epic #1105, sub-issue
// #1106), against a real PostgreSQL database with migrations V1 to V45 or
// later applied: sessions.time_mode and its default, the clock columns of
// stages, their CHECK constraints, the partial index of pending deadlines,
// and a replay of V45 that gives existing activities 'none' and leaves their
// phases without a clock.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. Every test runs inside a transaction that it
// rolls back, so it leaves no rows. The replay briefly locks the sessions and
// stages tables while doing so.

import assert from "node:assert/strict";
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
    "../../../../database/migrations/V45__activity_phase_clock.sql",
    import.meta.url
);

const INDEX_NAME = "idx_stages_pending_deadline";

// Same columns as the activity launch insert, which leaves time_mode to the
// default.
const INSERT_SESSION_SQL = `
    INSERT INTO sessions (name, descr, time, status, type)
    VALUES ('Integration session', '', now(), 1, 'T')
    RETURNING id;
`;

const INSERT_PHASE_SQL = `
    INSERT INTO stages (number, type, sesid)
    VALUES ($1, 'individual', $2)
    RETURNING id;
`;

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    return pool;
}

test.after(async () => {
    await pool?.end();
});

// Runs fn with a client inside a transaction that is always rolled back.
async function inRolledBackTransaction(fn) {
    const client = await getPool().connect();
    try {
        await client.query("BEGIN;");
        return await fn(client);
    } finally {
        await client.query("ROLLBACK;");
        client.release();
    }
}

// Runs a statement that must fail with a CHECK violation of the named
// constraint, inside a savepoint so the caller's transaction goes on.
async function assertCheckViolation(client, sql, params, constraint) {
    await client.query("SAVEPOINT check_violation;");
    await assert.rejects(
        client.query(sql, params),
        error => error.code === "23514" && error.constraint === constraint,
        `${sql} is refused by ${constraint}`
    );
    await client.query("ROLLBACK TO SAVEPOINT check_violation;");
}

async function columns(client, table, names) {
    const { rows } = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = ANY($2::text[])
        ORDER BY column_name;
    `, [table, names]);
    return rows;
}

async function checkConstraintNames(client, table) {
    const { rows } = await client.query(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = $1::regclass
          AND contype = 'c'
        ORDER BY conname;
    `, [table]);
    return rows.map(row => row.conname);
}

test("sessions.time_mode is a non-null text that defaults to 'none'", {
    skip: SKIP_REASON,
}, async () => {
    assert.deepEqual(await columns(getPool(), "sessions", ["time_mode"]), [{
        column_name:    "time_mode",
        data_type:      "text",
        is_nullable:    "NO",
        column_default: "'none'::text",
    }]);
});

test("the clock columns of stages are nullable and have no default", {
    skip: SKIP_REASON,
}, async () => {
    const names = [
        "started_at",
        "duration_seconds",
        "ends_at",
        "start_trigger",
        "deadline_handled_at",
    ];

    assert.deepEqual(await columns(getPool(), "stages", names), [
        {
            column_name:    "deadline_handled_at",
            data_type:      "timestamp with time zone",
            is_nullable:    "YES",
            column_default: null,
        },
        {
            column_name:    "duration_seconds",
            data_type:      "integer",
            is_nullable:    "YES",
            column_default: null,
        },
        {
            column_name:    "ends_at",
            data_type:      "timestamp with time zone",
            is_nullable:    "YES",
            column_default: null,
        },
        {
            column_name:    "start_trigger",
            data_type:      "text",
            is_nullable:    "YES",
            column_default: null,
        },
        {
            column_name:    "started_at",
            data_type:      "timestamp with time zone",
            is_nullable:    "YES",
            column_default: null,
        },
    ]);
});

test("a new activity reads 'none' and a new phase has no clock", {
    skip: SKIP_REASON,
}, async () => {
    await inRolledBackTransaction(async client => {
        const { rows: [session] } = await client.query(INSERT_SESSION_SQL);
        const { rows: [phase] } = await client.query(INSERT_PHASE_SQL, [1, session.id]);

        const { rows: [stored] } = await client.query(
            "SELECT time_mode FROM sessions WHERE id = $1;",
            [session.id]
        );
        const { rows: [clock] } = await client.query(`
            SELECT started_at, duration_seconds, ends_at, start_trigger, deadline_handled_at
            FROM stages
            WHERE id = $1;
        `, [phase.id]);

        assert.equal(stored.time_mode, "none");
        assert.deepEqual(clock, {
            started_at:          null,
            duration_seconds:    null,
            ends_at:             null,
            start_trigger:       null,
            deadline_handled_at: null,
        });
    });
});

test("sessions_time_mode_check accepts 'none', 'soft' and 'hard' only", {
    skip: SKIP_REASON,
}, async () => {
    await inRolledBackTransaction(async client => {
        assert.ok(
            (await checkConstraintNames(client, "sessions")).includes("sessions_time_mode_check")
        );
        const { rows: [session] } = await client.query(INSERT_SESSION_SQL);
        const update = "UPDATE sessions SET time_mode = $1 WHERE id = $2 RETURNING time_mode;";

        for (const mode of ["soft", "hard", "none"]) {
            const { rows: [row] } = await client.query(update, [mode, session.id]);
            assert.equal(row.time_mode, mode);
        }
        for (const mode of ["Soft", "", "paused"]) {
            await assertCheckViolation(
                client,
                update,
                [mode, session.id],
                "sessions_time_mode_check"
            );
        }
        await client.query("SAVEPOINT not_null;");
        await assert.rejects(
            client.query(update, [null, session.id]),
            error => error.code === "23502" && error.column === "time_mode"
        );
        await client.query("ROLLBACK TO SAVEPOINT not_null;");
    });
});

test("stages_duration_seconds_check refuses durations that are not positive", {
    skip: SKIP_REASON,
}, async () => {
    await inRolledBackTransaction(async client => {
        assert.ok(
            (await checkConstraintNames(client, "stages")).includes("stages_duration_seconds_check")
        );
        const { rows: [session] } = await client.query(INSERT_SESSION_SQL);
        const { rows: [phase] } = await client.query(INSERT_PHASE_SQL, [1, session.id]);
        const update = `
            UPDATE stages SET duration_seconds = $1 WHERE id = $2 RETURNING duration_seconds;
        `;

        for (const seconds of [1, 60, 10800, null]) {
            const { rows: [row] } = await client.query(update, [seconds, phase.id]);
            assert.equal(row.duration_seconds, seconds);
        }
        for (const seconds of [0, -60]) {
            await assertCheckViolation(
                client,
                update,
                [seconds, phase.id],
                "stages_duration_seconds_check"
            );
        }
    });
});

test("stages_start_trigger_check accepts 'teacher', 'deadline' or no trigger", {
    skip: SKIP_REASON,
}, async () => {
    await inRolledBackTransaction(async client => {
        assert.ok(
            (await checkConstraintNames(client, "stages")).includes("stages_start_trigger_check")
        );
        const { rows: [session] } = await client.query(INSERT_SESSION_SQL);
        const { rows: [phase] } = await client.query(INSERT_PHASE_SQL, [1, session.id]);
        const update = `
            UPDATE stages SET start_trigger = $1 WHERE id = $2 RETURNING start_trigger;
        `;

        for (const trigger of ["teacher", "deadline", null]) {
            const { rows: [row] } = await client.query(update, [trigger, phase.id]);
            assert.equal(row.start_trigger, trigger);
        }
        for (const trigger of ["Teacher", "", "runner"]) {
            await assertCheckViolation(
                client,
                update,
                [trigger, phase.id],
                "stages_start_trigger_check"
            );
        }
    });
});

test("the partial index holds the deadlines that are set and not yet handled", {
    skip: SKIP_REASON,
}, async () => {
    const { rows: [index] } = await getPool().query(`
        SELECT
            i.indisunique AS is_unique,
            i.indnatts AS column_count,
            pg_get_indexdef(i.indexrelid, 1, true) AS column_name,
            pg_get_expr(i.indpred, i.indrelid, true) AS predicate,
            am.amname AS method
        FROM pg_index AS i
        INNER JOIN pg_class AS c ON i.indexrelid = c.oid
        INNER JOIN pg_am AS am ON c.relam = am.oid
        WHERE i.indrelid = 'stages'::regclass
          AND c.relname = $1;
    `, [INDEX_NAME]);

    assert.deepEqual(index, {
        is_unique:    false,
        column_count: 1,
        column_name:  "ends_at",
        predicate:    "ends_at IS NOT NULL AND deadline_handled_at IS NULL",
        method:       "btree",
    });
});

test("a lookup of due deadlines can use the partial index", {
    skip: SKIP_REASON,
}, async () => {
    await inRolledBackTransaction(async client => {
        await client.query("SET LOCAL enable_seqscan = off;");
        const { rows } = await client.query(`
            EXPLAIN (FORMAT JSON)
            SELECT id
            FROM stages
            WHERE ends_at IS NOT NULL
              AND deadline_handled_at IS NULL
              AND ends_at <= now()
            ORDER BY ends_at;
        `);

        assert.match(JSON.stringify(rows[0]["QUERY PLAN"]), new RegExp(INDEX_NAME));
    });
});

test("replaying V45 gives existing activities 'none' and their phases no clock", {
    skip: SKIP_REASON,
}, async () => {
    const migrationSql = await readFile(MIGRATION_URL, "utf8");

    await inRolledBackTransaction(async client => {
        await client.query("SET LOCAL lock_timeout = '10s';");
        // Go back to the schema before V45, inside this transaction only.
        await client.query(`DROP INDEX ${INDEX_NAME};`);
        await client.query(`
            ALTER TABLE stages
            DROP COLUMN started_at,
            DROP COLUMN duration_seconds,
            DROP COLUMN ends_at,
            DROP COLUMN start_trigger,
            DROP COLUMN deadline_handled_at;
        `);
        await client.query("ALTER TABLE sessions DROP COLUMN time_mode;");

        const { rows: [session] } = await client.query(INSERT_SESSION_SQL);
        const { rows: [phase] } = await client.query(INSERT_PHASE_SQL, [1, session.id]);

        await client.query(migrationSql);

        const { rows: [existing] } = await client.query(
            "SELECT time_mode FROM sessions WHERE id = $1;",
            [session.id]
        );
        const { rows: [{ timed }] } = await client.query(
            "SELECT count(*)::int AS timed FROM sessions WHERE time_mode <> 'none';"
        );
        const { rows: [{ clocked }] } = await client.query(`
            SELECT count(*)::int AS clocked
            FROM stages
            WHERE started_at IS NOT NULL
               OR duration_seconds IS NOT NULL
               OR ends_at IS NOT NULL
               OR start_trigger IS NOT NULL
               OR deadline_handled_at IS NOT NULL;
        `);
        const { rows: [existingPhase] } = await client.query(
            "SELECT started_at, ends_at FROM stages WHERE id = $1;",
            [phase.id]
        );

        assert.equal(existing.time_mode, "none", "an existing activity reads 'none'");
        assert.equal(timed, 0, "every activity that existed before the migration reads 'none'");
        assert.deepEqual(existingPhase, { started_at: null, ends_at: null });
        assert.equal(clocked, 0, "no phase that existed before the migration has a clock");
    });
});

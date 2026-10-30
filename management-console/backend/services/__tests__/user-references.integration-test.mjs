// Compares the list of columns that hold a users.id (user-references.js)
// with the real schema, against a PostgreSQL database with migrations
// V1-V28 or later applied. A migration that adds a reference to users fails
// here until the reference is listed, so the deletion of a never-activated
// account cannot miss a table.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL.
// The tests only read the catalog.

import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';

import { USER_REFERENCE_RULES, USER_REFERENCES } from '../user-references.js';

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? false
  : 'ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.';

if (SKIP_REASON) {
  console.warn(SKIP_REASON);
}

// pg_constraint.confdeltype codes.
const RULE_BY_DELETE_TYPE = Object.freeze({
  a: USER_REFERENCE_RULES.noAction,
  r: USER_REFERENCE_RULES.restrict,
  c: USER_REFERENCE_RULES.cascade,
  n: USER_REFERENCE_RULES.setNull,
  d: 'SET DEFAULT'
});

// Integer columns whose name says they hold a user id. One of them without a
// foreign key must be listed as a reference without one.
const USER_LIKE_COLUMN_PATTERN = '^(uid|userid|user_id|creator|leader)$|_user_id$|_by$';

let pool = null;

function getPool() {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  return pool;
}

async function query(sql, params = []) {
  return (await getPool().query(sql, params)).rows;
}

test.after(async () => {
  await pool?.end();
});

function key(table, column) {
  return `${table}.${column}`;
}

test('every foreign key to users is listed, with its ON DELETE rule', { skip: SKIP_REASON }, async () => {
  const rows = await query(`
    SELECT
      source.relname AS table_name,
      array_agg(attribute.attname::text ORDER BY keys.ordinality) AS columns,
      constraint_row.confdeltype AS delete_type
    FROM pg_constraint constraint_row
    JOIN pg_class source ON source.oid = constraint_row.conrelid
    JOIN pg_namespace source_namespace ON source_namespace.oid = source.relnamespace
    CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.conrelid
     AND attribute.attnum = keys.attnum
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.users'::regclass
      AND source_namespace.nspname = 'public'
    GROUP BY constraint_row.oid, source.relname, constraint_row.confdeltype
  `);

  for (const row of rows) {
    assert.equal(row.columns.length, 1, `${row.table_name} has a single-column foreign key to users`);
  }

  const schemaReferences = rows
    .map((row) => `${key(row.table_name, row.columns[0])} ${RULE_BY_DELETE_TYPE[row.delete_type]}`)
    .sort();
  const listedReferences = USER_REFERENCES
    .filter((entry) => entry.onDelete !== null)
    .map((entry) => `${key(entry.table, entry.column)} ${entry.onDelete}`)
    .sort();

  assert.deepEqual(listedReferences, schemaReferences);
});

test('every listed column without a foreign key exists and has none', { skip: SKIP_REASON }, async () => {
  const withoutForeignKey = USER_REFERENCES.filter((entry) => entry.onDelete === null);
  assert.ok(withoutForeignKey.length > 0);

  for (const entry of withoutForeignKey) {
    const rows = await query(
      `
        SELECT
          column_row.data_type,
          EXISTS (
            SELECT 1
            FROM pg_constraint constraint_row
            JOIN pg_attribute attribute
              ON attribute.attrelid = constraint_row.conrelid
             AND attribute.attnum = ANY (constraint_row.conkey)
            WHERE constraint_row.contype = 'f'
              AND constraint_row.conrelid = format('public.%I', $1::text)::regclass
              AND attribute.attname = $2
          ) AS has_foreign_key
        FROM information_schema.columns column_row
        WHERE column_row.table_schema = 'public'
          AND column_row.table_name = $1
          AND column_row.column_name = $2
      `,
      [entry.table, entry.column]
    );

    assert.equal(rows.length, 1, `${key(entry.table, entry.column)} exists`);
    assert.equal(rows[0].data_type, 'integer', key(entry.table, entry.column));
    assert.equal(rows[0].has_foreign_key, false, `${key(entry.table, entry.column)} has no foreign key`);
  }
});

test('every user-like integer column without a foreign key is listed', { skip: SKIP_REASON }, async () => {
  const rows = await query(
    `
      SELECT column_row.table_name, column_row.column_name
      FROM information_schema.columns column_row
      JOIN information_schema.tables table_row
        ON table_row.table_schema = column_row.table_schema
       AND table_row.table_name = column_row.table_name
       AND table_row.table_type = 'BASE TABLE'
      WHERE column_row.table_schema = 'public'
        AND column_row.data_type IN ('integer', 'bigint')
        AND column_row.column_name ~ $1
        AND NOT EXISTS (
          SELECT 1
          FROM pg_constraint constraint_row
          JOIN pg_attribute attribute
            ON attribute.attrelid = constraint_row.conrelid
           AND attribute.attnum = ANY (constraint_row.conkey)
          WHERE constraint_row.contype = 'f'
            AND constraint_row.conrelid = format('public.%I', column_row.table_name)::regclass
            AND attribute.attname = column_row.column_name
        )
    `,
    [USER_LIKE_COLUMN_PATTERN]
  );

  const listed = new Set(USER_REFERENCES.map((entry) => key(entry.table, entry.column)));
  const unlisted = rows
    .map((row) => key(row.table_name, row.column_name))
    .filter((column) => !listed.has(column))
    .sort();

  assert.deepEqual(unlisted, [], 'user-like columns missing from user-references.js');
  assert.ok(rows.length > 0, 'the documented columns without a foreign key are found');
});

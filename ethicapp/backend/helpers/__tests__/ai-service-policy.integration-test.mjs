// Integration tests for the adapters a policy version switches off (V26,
// #864), against a real PostgreSQL database with migrations V1-V26 applied.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert policy versions, which are
// append-only and are never removed.

import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import { createAiServicePolicyStore } from "../ai-service-policy.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

if (SKIP_REASON) {
    console.warn(SKIP_REASON);
}

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

test("V26: the seed version and versions saved without the column disable nothing", {
    skip: SKIP_REASON,
}, async () => {
    const [seed] = await query(`
        SELECT disabled_adapter_ids FROM ai_service_policy_versions WHERE id = 1;
    `);
    assert.deepEqual(seed.disabled_adapter_ids, []);

    const [row] = await query(`
        INSERT INTO ai_service_policy_versions (allowed_service_ids, note)
        VALUES ('{case-analyst}', 'Integration: no column')
        RETURNING id;
    `);
    const store = createAiServicePolicyStore({ getDb: async () => getPool() });
    const version = await store.getPolicyVersion(row.id);

    assert.deepEqual(version.allowedServiceIds, ["case-analyst"]);
    assert.deepEqual(version.disabledAdapterIds, []);
});

test("V26: a version stores the adapters it switches off, and the store reads them", {
    skip: SKIP_REASON,
}, async () => {
    const [row] = await query(`
        INSERT INTO ai_service_policy_versions
            (allowed_service_ids, disabled_adapter_ids, note)
        VALUES ($1::text[], $2::text[], 'Integration: typology off')
        RETURNING id;
    `, [["case-analyst"], ["case-analyst-claim-typology"]]);
    const store = createAiServicePolicyStore({ getDb: async () => getPool() });

    const current = await store.getCurrentPolicyVersion();
    assert.equal(current.id, Number(row.id));
    assert.deepEqual(current.disabledAdapterIds, ["case-analyst-claim-typology"]);
});

test("V26: a NULL adapter id is rejected", { skip: SKIP_REASON }, async () => {
    await assert.rejects(
        query(`
            INSERT INTO ai_service_policy_versions (allowed_service_ids, disabled_adapter_ids)
            VALUES ('{}', ARRAY[NULL]::text[]);
        `),
        error => error.constraint === "ai_service_policy_versions_disabled_ids_check"
    );
    await assert.rejects(
        query(`
            INSERT INTO ai_service_policy_versions (allowed_service_ids, disabled_adapter_ids)
            VALUES ('{}', NULL);
        `),
        error => error.code === "23502"
    );
});

test("V26: versions stay append-only", { skip: SKIP_REASON }, async () => {
    const [row] = await query(`
        INSERT INTO ai_service_policy_versions (allowed_service_ids, note)
        VALUES ('{}', 'Integration: append-only')
        RETURNING id;
    `);

    await assert.rejects(
        query(`
            UPDATE ai_service_policy_versions
            SET disabled_adapter_ids = '{case-analyst-evaluation}'
            WHERE id = $1;
        `, [row.id]),
        error => error.code === "23001"
    );
});

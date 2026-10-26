import assert from "node:assert/strict";
import test from "node:test";

import {
    createAiServicePolicyStore,
    pinSessionPolicy,
} from "../ai-service-policy.js";

const normalize = sql => sql.replace(/\s+/g, " ").trim();

// A fake `pg` queryable: each call takes the next queued answer (rows).
function makeDb(...answers) {
    const calls = [];
    const db = {
        async query(sql, params = []) {
            calls.push({ sql: normalize(sql), params });
            return { rows: answers.length > 0 ? answers.shift() : [] };
        },
    };
    return { db, calls, getDb: async () => db };
}

const VERSION_ROW = {
    id:                  "3",
    allowed_service_ids: ["polyadic-agent"],
    note:                "Pilot",
    created_at:          new Date("2026-10-26T10:00:00Z"),
    created_by:          7,
};

// ─── connection ──────────────────────────────────────────────────────────────

test("getConnection: no row means no connection", async () => {
    const { getDb, calls } = makeDb([]);
    const store = createAiServicePolicyStore({ getDb });

    assert.equal(await store.getConnection(), null);
    assert.match(calls[0].sql, /FROM ai_additions_connection WHERE id = 1;$/);
});

test("getConnection: maps the stored row and is never cached", async () => {
    const updatedAt = new Date("2026-10-26T09:00:00Z");
    const { getDb, calls } = makeDb(
        [{
            base_url:            "http://ai-additions",
            keycloak_public_url: null,
            updated_at:          updatedAt,
            updated_by:          4,
        }],
        [{
            base_url:            "https://ai.example.org",
            keycloak_public_url: "https://auth.example.org/keycloak",
            updated_at:          updatedAt,
            updated_by:          null,
        }]
    );
    const store = createAiServicePolicyStore({ getDb });

    assert.deepEqual(await store.getConnection(), {
        baseUrl:           "http://ai-additions",
        keycloakPublicUrl: null,
        updatedAt,
        updatedBy:         4,
    });
    assert.deepEqual(await store.getConnection(), {
        baseUrl:           "https://ai.example.org",
        keycloakPublicUrl: "https://auth.example.org/keycloak",
        updatedAt,
        updatedBy:         null,
    });
    assert.equal(calls.length, 2);
});

// ─── policy versions ─────────────────────────────────────────────────────────

test("getCurrentPolicyVersion: reads the highest id every time", async () => {
    const seed = {
        id:                  "1",
        allowed_service_ids: [],
        note:                "Initial",
        created_at:          new Date(0),
        created_by:          null,
    };
    const { getDb, calls } = makeDb([seed], [VERSION_ROW]);
    const store = createAiServicePolicyStore({ getDb });

    const first = await store.getCurrentPolicyVersion();
    assert.equal(first.id, 1);
    assert.deepEqual(first.allowedServiceIds, []);
    assert.equal(first.createdBy, null);

    const second = await store.getCurrentPolicyVersion();
    assert.equal(second.id, 3);
    assert.deepEqual(second.allowedServiceIds, ["polyadic-agent"]);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /FROM ai_service_policy_versions ORDER BY id DESC LIMIT 1;$/);
});

test("getCurrentPolicyVersion: null when no version exists", async () => {
    const { getDb } = makeDb([]);
    const store = createAiServicePolicyStore({ getDb });

    assert.equal(await store.getCurrentPolicyVersion(), null);
});

test("getPolicyVersion: maps the row to a frozen version", async () => {
    const { getDb, calls } = makeDb([VERSION_ROW]);
    const store = createAiServicePolicyStore({ getDb });

    const version = await store.getPolicyVersion(3);
    assert.deepEqual(version, {
        id:                3,
        allowedServiceIds: ["polyadic-agent"],
        note:              "Pilot",
        createdAt:         VERSION_ROW.created_at,
        createdBy:         7,
    });
    assert.ok(Object.isFrozen(version));
    assert.ok(Object.isFrozen(version.allowedServiceIds));
    assert.deepEqual(calls[0].params, [3]);
});

test("getPolicyVersion: versions are cached without expiry", async () => {
    const { getDb, calls } = makeDb([VERSION_ROW]);
    const store = createAiServicePolicyStore({ getDb });

    const first = await store.getPolicyVersion("3");
    const second = await store.getPolicyVersion(3);

    assert.equal(second, first);
    assert.equal(calls.length, 1);
});

test("getPolicyVersion: the current version is cached once read", async () => {
    const { getDb, calls } = makeDb([VERSION_ROW]);
    const store = createAiServicePolicyStore({ getDb });

    const current = await store.getCurrentPolicyVersion();
    assert.equal(await store.getPolicyVersion(3), current);
    assert.equal(calls.length, 1);
});

test("getPolicyVersion: unknown ids are not cached", async () => {
    const { getDb, calls } = makeDb([], [VERSION_ROW]);
    const store = createAiServicePolicyStore({ getDb });

    assert.equal(await store.getPolicyVersion(3), null);
    assert.equal((await store.getPolicyVersion(3)).id, 3);
    assert.equal(calls.length, 2);
});

test("getPolicyVersion: invalid ids return null without a query", async () => {
    const { getDb, calls } = makeDb();
    const store = createAiServicePolicyStore({ getDb });

    for (const id of [null, undefined, "", "abc", 0, -1, 1.5]) {
        assert.equal(await store.getPolicyVersion(id), null);
    }
    assert.equal(calls.length, 0);
});

// ─── the session pin ─────────────────────────────────────────────────────────

const LOCK_SESSION =
    /^SELECT ai_service_policy_version_id FROM sessions WHERE id = \$1 FOR UPDATE;$/;

test("pinSessionPolicy: locks the session, then pins it while it has no activity", async () => {
    const { db, calls } = makeDb(
        [{ ai_service_policy_version_id: "1" }],
        [{ ai_service_policy_version_id: "4" }]
    );

    assert.equal(await pinSessionPolicy(db, 12), 4);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, LOCK_SESSION);
    assert.deepEqual(calls[0].params, [12]);
    assert.match(calls[1].sql, new RegExp("^UPDATE sessions "
        + "SET ai_service_policy_version_id = current_ai_service_policy_version_id\\(\\)"));
    assert.match(calls[1].sql, new RegExp("AND NOT EXISTS \\( SELECT 1 FROM activity "
        + "WHERE activity.session = sessions.id \\)"));
    assert.deepEqual(calls[1].params, [12]);
});

test("pinSessionPolicy: a launched session keeps the pin read under the lock", async () => {
    const { db, calls } = makeDb([{ ai_service_policy_version_id: "2" }], []);

    assert.equal(await pinSessionPolicy(db, 12), 2);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, LOCK_SESSION);
});

test("pinSessionPolicy: null for an unknown session, without an update", async () => {
    const { db, calls } = makeDb([]);

    assert.equal(await pinSessionPolicy(db, 999), null);
    assert.equal(calls.length, 1);
});

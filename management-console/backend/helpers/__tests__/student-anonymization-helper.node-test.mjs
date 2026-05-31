import assert from "node:assert/strict";
import test from "node:test";

import {
    buildAnonymousStudentIdentity,
    parseStudentAnonymizationOptions,
    resolveRunStatus,
    runStudentAnonymization,
} from "../student-anonymization-helper.js";

class FakeClient {
    constructor(handler) {
        this.calls = [];
        this.handler = handler;
        this.released = false;
    }

    async query(sql, params = []) {
        const call = {
            sql: String(sql).replace(/\s+/g, " ").trim(),
            params,
        };
        this.calls.push(call);
        return this.handler(call.sql, params, this.calls);
    }

    release() {
        this.released = true;
    }
}

class FakePool {
    constructor(handler) {
        this.client = new FakeClient(handler);
    }

    async connect() {
        return this.client;
    }
}

function createSilentLogger() {
    return {
        info() {},
        error() {},
    };
}

function createQueryHandler({ candidates = [], lockedUsers = candidates } = {}) {
    return (sql, params) => {
        if (sql.includes("SELECT id, mail FROM users WHERE role = $1")) {
            return { rows: candidates, rowCount: candidates.length };
        }

        if (sql.includes("INSERT INTO student_anonymization_runs")) {
            return { rows: [{ id: 77 }], rowCount: 1 };
        }

        if (sql.includes("SELECT id, mail FROM users WHERE id = $1")) {
            const user = lockedUsers.find(candidate => candidate.id === params[0]);
            return {
                rows: user ? [user] : [],
                rowCount: user ? 1 : 0,
            };
        }

        return { rows: [], rowCount: 1 };
    };
}

test("buildAnonymousStudentIdentity creates stable reusable-safe account values", () => {
    assert.deepEqual(buildAnonymousStudentIdentity(42), {
        name:      "Anonymous Student 42",
        firstname: "Anonymous",
        lastname:  "Student 42",
        email:     "anon-student-42@anonymous.invalid",
        rut:       "ANON-42",
    });
});

test("parseStudentAnonymizationOptions accepts CLI and environment values", () => {
    const options = parseStudentAnonymizationOptions(
        ["--dry-run", "--placeholder=REDACTED", "--triggered-by=operator", "--process-name=manual-run"],
        {}
    );

    assert.deepEqual(options, {
        dryRun:          true,
        placeholderText: "REDACTED",
        triggeredBy:     "operator",
        processName:     "manual-run",
    });
});

test("resolveRunStatus reports failed only when every target failed", () => {
    assert.equal(resolveRunStatus({ total: 2, succeeded: 2, failed: 0 }), "completed");
    assert.equal(resolveRunStatus({ total: 2, succeeded: 1, failed: 1 }), "completed_with_failures");
    assert.equal(resolveRunStatus({ total: 2, succeeded: 0, failed: 2 }), "failed");
});

test("runStudentAnonymization dry-run records skipped events without changing data", async () => {
    const pool = new FakePool(createQueryHandler({
        candidates: [
            { id: 1, mail: "student1@example.test" },
            { id: 2, mail: "student2@example.test" },
        ],
    }));

    const result = await runStudentAnonymization({
        pool,
        options: {
            dryRun: true,
        },
        logger: createSilentLogger(),
    });

    assert.equal(result.runId, 77);
    assert.equal(result.total, 2);
    assert.equal(result.succeeded, 0);
    assert.equal(result.skipped, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.status, "completed");

    assert.equal(pool.client.calls.some(call => call.sql.includes("UPDATE users SET")), false);
    assert.equal(pool.client.calls.some(call => call.sql.includes("UPDATE differential_selection")), false);
    assert.equal(pool.client.calls.some(call => call.sql.includes("UPDATE differential_chat")), false);
    assert.equal(pool.client.calls.some(call => call.sql.includes("UPDATE chat")), false);
    assert.equal(pool.client.calls.some(call => call.sql.includes("UPDATE actor_selection")), false);
    assert.equal(pool.client.calls.some(call => call.sql.includes("UPDATE sesusers")), false);
    assert.equal(
        pool.client.calls.filter(call => call.sql.includes("'Dry run: account would be anonymized.'")).length,
        2
    );
});

test("runStudentAnonymization anonymizes account, free-text data, session devices, and stale reset tokens", async () => {
    const pool = new FakePool(createQueryHandler({
        candidates: [{ id: 5, mail: "student5@example.test" }],
    }));

    const result = await runStudentAnonymization({
        pool,
        options: {
            dryRun: false,
            placeholderText: "******",
        },
        logger: createSilentLogger(),
    });

    assert.equal(result.succeeded, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed, 0);

    const userUpdate = pool.client.calls.find(call => call.sql.includes("UPDATE users SET"));
    assert.ok(userUpdate);
    assert.deepEqual(userUpdate.params, [
        "Anonymous Student 5",
        "Anonymous",
        "Student 5",
        "anon-student-5@anonymous.invalid",
        "ANON-5",
        77,
        5,
    ]);
    assert.match(userUpdate.sql, /active = false/);
    assert.match(userUpdate.sql, /email_confirmed = false/);
    assert.match(userUpdate.sql, /sex = NULL/);
    assert.match(userUpdate.sql, /last_login_at = NULL/);
    assert.match(userUpdate.sql, /session_version = session_version \+ 1/);

    assert.ok(pool.client.calls.some(call => call.sql.includes("UPDATE differential_selection SET comment = $1")));
    assert.ok(pool.client.calls.some(call => call.sql.includes("UPDATE differential_chat SET content = $1")));
    assert.ok(pool.client.calls.some(call => call.sql.includes("UPDATE chat SET content = $1")));
    assert.ok(pool.client.calls.some(call => call.sql.includes("UPDATE actor_selection SET description = $1")));
    assert.ok(pool.client.calls.some(call => call.sql.includes("UPDATE sesusers SET device = NULL")));
    assert.ok(pool.client.calls.some(call => call.sql.includes("DELETE FROM pass_reset")));
    assert.ok(pool.client.calls.some(call => call.sql === "COMMIT"));
});

test("runStudentAnonymization skips a candidate that was already anonymized before lock", async () => {
    const pool = new FakePool(createQueryHandler({
        candidates:   [{ id: 9, mail: "student9@example.test" }],
        lockedUsers:  [],
    }));

    const result = await runStudentAnonymization({
        pool,
        options: {
            dryRun: false,
        },
        logger: createSilentLogger(),
    });

    assert.equal(result.succeeded, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.failed, 0);
    assert.equal(pool.client.calls.some(call => call.sql.includes("UPDATE users SET")), false);
    assert.ok(pool.client.calls.some(call => call.sql === "COMMIT"));
});

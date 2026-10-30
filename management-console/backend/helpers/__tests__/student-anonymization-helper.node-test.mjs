import assert from "node:assert/strict";
import test from "node:test";

import {
    anonymizeAccountInTransaction,
    buildAnonymousIdentity,
    buildAnonymousStudentIdentity,
    buildAnonymousTeacherIdentity,
    createAnonymizationRun,
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

        if (sql.includes("FROM users WHERE id = $1 AND role = $2")) {
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

test("runStudentAnonymization keeps the account creation date", async () => {
    const pool = new FakePool(createQueryHandler({
        candidates: [{ id: 6, mail: "student6@example.test" }],
    }));

    const result = await runStudentAnonymization({
        pool,
        options: {
            dryRun: false,
        },
        logger: createSilentLogger(),
    });

    assert.equal(result.succeeded, 1);
    const userUpdate = pool.client.calls.find(call => call.sql.includes("UPDATE users SET"));
    assert.ok(userUpdate);
    // users.created_at (V28) does not identify anyone and keeps the
    // account's age for audits, so no statement on users touches it.
    const userStatements = pool.client.calls.filter(call => /\busers\b/.test(call.sql));
    assert.ok(userStatements.length > 0);
    assert.equal(userStatements.some(call => call.sql.includes("created_at")), false);
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
    assert.equal(pool.client.calls.some(call => call.sql.includes("user_erasure_requests")), false);
    assert.ok(pool.client.calls.some(call => call.sql === "COMMIT"));
});

test("runStudentAnonymization erases AI service payloads and records pending erasure requests (#876)", async () => {
    const pool = new FakePool(createQueryHandler({
        candidates: [{ id: 5, mail: "student5@example.test" }],
    }));

    const result = await runStudentAnonymization({
        pool,
        options: {
            dryRun:          false,
            placeholderText: "******",
        },
        logger: createSilentLogger(),
    });

    assert.equal(result.succeeded, 1);
    const statements = pool.client.calls.map(call => call.sql);
    const beginIndex = statements.indexOf("BEGIN");
    const commitIndex = statements.indexOf("COMMIT");
    const resultsIndex = statements.findIndex(sql => sql.includes("FROM external_service_results WHERE user_id = $1"));
    const jobsIndex = statements.findIndex(sql => sql.includes("FROM external_service_jobs WHERE user_id = $1"));
    const requestsIndex = statements.findIndex(sql => sql.startsWith("INSERT INTO user_erasure_requests"));

    // Inside the account's transaction.
    for (const index of [resultsIndex, jobsIndex, requestsIndex]) {
        assert.ok(index > beginIndex && index < commitIndex);
    }
    assert.deepEqual(pool.client.calls[requestsIndex].params, [5, ["argumentation-tutor", "polyadic-agent"], 77]);

    const succeeded = pool.client.calls.find(call => call.sql.includes("SET status = 'succeeded'"));
    assert.match(succeeded.params[0], /external_service_results payloads erased: 0\./);
    assert.match(succeeded.params[0], /AI service erasure requests recorded: argumentation-tutor, polyadic-agent\./);
});

test("runStudentAnonymization dry run records no erasure request", async () => {
    const pool = new FakePool(createQueryHandler({
        candidates: [{ id: 5, mail: "student5@example.test" }],
    }));

    await runStudentAnonymization({ pool, options: { dryRun: true }, logger: createSilentLogger() });

    assert.equal(pool.client.calls.some(call => call.sql.includes("user_erasure_requests")), false);
    assert.equal(pool.client.calls.some(call => call.sql.includes("external_service_results")), false);
});

test("buildAnonymousTeacherIdentity names a former teacher (#877)", () => {
    assert.deepEqual(buildAnonymousTeacherIdentity(42), {
        name:      "Former Teacher 42",
        firstname: "Former",
        lastname:  "Teacher 42",
        email:     "anon-teacher-42@anonymous.invalid",
        rut:       "ANON-42",
    });
    assert.deepEqual(buildAnonymousIdentity("A", 42), buildAnonymousStudentIdentity(42));
    assert.throws(() => buildAnonymousIdentity("S", 42), /cannot be anonymized/);
});

test("the step deletes the account's passkeys and records the deletion of its profile images", async () => {
    const pool = new FakePool(createQueryHandler({
        candidates:  [{ id: 5, mail: "student5@example.test" }],
        lockedUsers: [{
            id:                        5,
            mail:                      "student5@example.test",
            profile_image_path:        "/uploads/user-profiles/5/user-5-original.jpg",
            profile_image_topbar_path: "/uploads/user-profiles/5/user-5-topbar-64.jpg",
        }],
    }));

    await runStudentAnonymization({ pool, options: { dryRun: false }, logger: createSilentLogger() });

    const statements = pool.client.calls.map(call => call.sql);
    const passkeys = pool.client.calls.find(call => call.sql.startsWith("DELETE FROM user_passkeys"));
    assert.deepEqual(passkeys.params, [5]);
    const uploads = pool.client.calls.find(call => call.sql.startsWith("INSERT INTO upload_deletion_requests"));
    assert.deepEqual(uploads.params, [
        5,
        ["user-profiles/5/user-5-original.jpg", "user-profiles/5/user-5-topbar-64.jpg"],
        [false, false],
        [0, 0],
        77,
    ]);
    // Both inside the account's transaction.
    for (const sql of [passkeys.sql, uploads.sql]) {
        const index = statements.indexOf(sql);
        assert.ok(index > statements.indexOf("BEGIN") && index < statements.indexOf("COMMIT"));
    }
});

test("an account without profile images records no file deletion", async () => {
    const pool = new FakePool(createQueryHandler({ candidates: [{ id: 5, mail: "student5@example.test" }] }));

    await runStudentAnonymization({ pool, options: { dryRun: false }, logger: createSilentLogger() });

    assert.equal(pool.client.calls.some(call => call.sql.includes("upload_deletion_requests")), false);
});

test("anonymizeAccountInTransaction anonymizes a teacher as a teacher, in a run of role P", async () => {
    const client = new FakeClient(createQueryHandler({ lockedUsers: [{ id: 8, mail: "teacher8@example.test" }] }));

    const runId = await createAnonymizationRun(client, {
        dryRun:          false,
        placeholderText: "******",
        triggeredBy:     "admin-user:1",
        processName:     "mng-console",
        targetRole:      "P",
    }, 1);
    const result = await anonymizeAccountInTransaction(client, runId, { id: 8 }, {
        placeholderText: "******",
        targetRole:      "P",
    });

    assert.equal(result.status, "succeeded");
    const run = client.calls.find(call => call.sql.startsWith("INSERT INTO student_anonymization_runs"));
    assert.equal(run.params[2], "P");
    const lock = client.calls.find(call => call.sql.includes("FROM users WHERE id = $1 AND role = $2"));
    assert.deepEqual(lock.params, [8, "P"]);
    const userUpdate = client.calls.find(call => call.sql.includes("UPDATE users SET"));
    assert.deepEqual(userUpdate.params.slice(0, 5), [
        "Former Teacher 8", "Former", "Teacher 8", "anon-teacher-8@anonymous.invalid", "ANON-8",
    ]);
    assert.ok(client.calls.some(call => call.sql.includes("UPDATE chat SET content = $1")));
});

test("anonymizeAccountInTransaction skips an account that is no longer a teacher", async () => {
    const client = new FakeClient(createQueryHandler({ lockedUsers: [] }));

    const result = await anonymizeAccountInTransaction(client, 3, { id: 8 }, {
        placeholderText: "******",
        targetRole:      "P",
    });

    assert.equal(result.status, "skipped");
    const skipped = client.calls.find(call => call.sql.includes("SET status = 'skipped'"));
    assert.equal(skipped.params[2], "Account was already anonymized or is no longer a teacher.");
    assert.equal(client.calls.some(call => call.sql.includes("UPDATE users SET")), false);
});

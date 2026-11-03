// DELETE /cases/:id (#1010, epic #1008). The checks and the delete run in one
// transaction, after locking the case and the designs that use it: a missing
// case and another teacher's case answer 404 CASE_NOT_FOUND, a case an
// activity was launched from 409 CASE_USED_BY_LAUNCHED_ACTIVITY, and a case
// another teacher's design uses 409 CASE_USED_BY_OTHER_TEACHERS. Otherwise
// the case is deleted, its copies included in the database's ON DELETE SET
// NULL (V40), and its upload directory is removed once the transaction
// commits. PostgreSQL is a fake pg pool that answers by matching the SQL, and
// the uploads root is a temporary directory, so nothing here needs a
// database.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import pg from "pg";

import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

// The uploads root is read when the controller is imported.
const uploadsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ethicapp-cases-delete-"));
process.env.UPLOADS_PATH = uploadsRoot;
const { default: casesRouter } = await import("../cases.js");

const OWNER_ID = 7;
const OTHER_TEACHER_ID = 8;
const CASE_ID = 41;
const MISSING_CASE_ID = 999;

const state = {
    launched:            false,
    otherTeacherDesigns: 0,
    referenced:          false,
    failDelete:          false,
};

const OWNERSHIP_SQL =
    /SELECT id\s+FROM ethical_cases\s+WHERE id = \$1\s+AND creator = \$2\s+FOR UPDATE/u;
const DESIGNS_LOCK_SQL = /SELECT id\s+FROM designs\s+WHERE case_id = \$1\s+FOR UPDATE/u;
const LAUNCHED_SQL = /INNER JOIN activity a ON a\.design = d\.id\s+WHERE d\.case_id = \$1/u;
const OTHER_TEACHERS_SQL = /SELECT COUNT\(\*\)::int AS count\s+FROM designs\s+WHERE case_id = \$1/u;
const STILL_REFERENCED_SQL = /AS referenced/u;

function rowsFor(sql, params) {
    if (OWNERSHIP_SQL.test(sql)) {
        const [caseId, uid] = params;
        return Number(caseId) === CASE_ID && Number(uid) === OWNER_ID ? [{ id: CASE_ID }] : [];
    }
    if (LAUNCHED_SQL.test(sql)) {
        return state.launched ? [{ id: 3 }] : [];
    }
    if (OTHER_TEACHERS_SQL.test(sql)) {
        return [{ count: state.otherTeacherDesigns }];
    }
    if (/^\s*DELETE FROM ethical_cases\b/u.test(sql)) {
        if (state.failDelete) {
            throw new Error("connection lost");
        }
        return [];
    }
    if (STILL_REFERENCED_SQL.test(sql)) {
        return [{ referenced: state.referenced }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

// Every connection taken from the pool must be released, whichever path the
// handler takes.
const connections = { taken: 0, released: 0 };
const fakeConnect = pg.Pool.prototype.connect;
pg.Pool.prototype.connect = async function connect() {
    const client = await fakeConnect.call(this);
    connections.taken += 1;
    return {
        ...client,
        release() {
            connections.released += 1;
        },
    };
};

const caseDirectory = path.join(uploadsRoot, "cases", String(CASE_ID));
const otherCaseDirectory = path.join(uploadsRoot, "cases", "42");

async function exists(target) {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function writeCaseFiles(directory) {
    await fs.mkdir(path.join(directory, "rendered"), { recursive: true });
    await fs.writeFile(path.join(directory, "case.pdf"), "%PDF-1.4");
    await fs.writeFile(path.join(directory, "rendered", "page-1.png"), "png");
    await fs.writeFile(path.join(directory, "representation.json"), "{}");
}

before(async () => {
    await writeCaseFiles(otherCaseDirectory);
});

after(async () => {
    db.restore();
    await fs.rm(uploadsRoot, { recursive: true, force: true });
});

beforeEach(async () => {
    db.reset();
    state.launched = false;
    state.otherTeacherDesigns = 0;
    state.referenced = false;
    state.failDelete = false;
    connections.taken = 0;
    connections.released = 0;
    await writeCaseFiles(caseDirectory);
});

function deleteCase({ caseId = CASE_ID, uid = OWNER_ID } = {}) {
    return requestRouter(casesRouter, {
        method:  "DELETE",
        path:    `/cases/${caseId}`,
        session: { uid, role: "P" },
    });
}

function statements() {
    return db.queries.map(query => query.sql.trim());
}

function indexOf(pattern) {
    return statements().findIndex(sql => pattern.test(sql));
}

function ranDelete() {
    return indexOf(/^DELETE FROM ethical_cases\b/u) >= 0;
}

function assertConnectionsReleased() {
    assert.ok(connections.taken > 0);
    assert.equal(connections.released, connections.taken);
}

function transactionEnd() {
    return statements().filter(sql => sql === "COMMIT" || sql === "ROLLBACK");
}

const CASE_NOT_FOUND = { status: "err", message: "Case not found.", code: "CASE_NOT_FOUND" };

describe("DELETE /cases/:id", () => {
    it("deletes a case nobody else uses, and its upload directory", async () => {
        const { status, body } = await deleteCase();

        assert.equal(status, 200);
        assert.equal(body.status, "ok");
        assert.ok(ranDelete());
        assert.deepEqual(transactionEnd(), ["COMMIT"]);
        assert.equal(await exists(caseDirectory), false);
        assert.equal(await exists(otherCaseDirectory), true);
        assertConnectionsReleased();
    });

    it("locks the case and its designs before the checks, and checks before deleting", async () => {
        await deleteCase();

        const caseLock = indexOf(OWNERSHIP_SQL);
        const designsLock = indexOf(DESIGNS_LOCK_SQL);
        const launchedCheck = indexOf(LAUNCHED_SQL);
        const otherTeachersCheck = indexOf(OTHER_TEACHERS_SQL);
        const deletion = indexOf(/^DELETE FROM ethical_cases\b/u);

        assert.equal(statements()[0], "BEGIN");
        assert.ok(caseLock > 0);
        assert.ok(designsLock > caseLock);
        assert.ok(launchedCheck > designsLock);
        assert.ok(otherTeachersCheck > launchedCheck);
        assert.ok(deletion > otherTeachersCheck);
        assert.ok(indexOf(/^COMMIT$/u) > deletion);
        // The directory is checked for references once the case is gone.
        assert.ok(indexOf(STILL_REFERENCED_SQL) > indexOf(/^COMMIT$/u));
    });

    it("counts only the designs of other teachers", async () => {
        await deleteCase();

        const query = db.queries.find(({ sql }) => OTHER_TEACHERS_SQL.test(sql));
        assert.match(query.sql, /creator <> \$2/u);
        assert.deepEqual(query.params, [CASE_ID, OWNER_ID]);
    });

    it("answers a missing case and another teacher's case with one 404", async () => {
        const missing = await deleteCase({ caseId: MISSING_CASE_ID });
        const notOwned = await deleteCase({ uid: OTHER_TEACHER_ID });

        assert.deepEqual(missing, { status: 404, body: CASE_NOT_FOUND });
        assert.deepEqual(notOwned, { status: 404, body: CASE_NOT_FOUND });
        assert.equal(ranDelete(), false);
        assert.equal(indexOf(LAUNCHED_SQL), -1);
        assert.deepEqual(transactionEnd(), ["ROLLBACK", "ROLLBACK"]);
        assert.equal(await exists(caseDirectory), true);
        assertConnectionsReleased();
    });

    it("answers 409 CASE_USED_BY_LAUNCHED_ACTIVITY, and deletes nothing", async () => {
        state.launched = true;
        state.otherTeacherDesigns = 2;

        const { status, body } = await deleteCase();

        assert.equal(status, 409);
        assert.equal(body.code, "CASE_USED_BY_LAUNCHED_ACTIVITY");
        assert.equal(ranDelete(), false);
        assert.deepEqual(transactionEnd(), ["ROLLBACK"]);
        assert.equal(await exists(caseDirectory), true);
        assertConnectionsReleased();
    });

    it("answers 409 CASE_USED_BY_OTHER_TEACHERS for another teacher's design", async () => {
        state.otherTeacherDesigns = 1;

        const { status, body } = await deleteCase();

        assert.equal(status, 409);
        assert.equal(body.status, "err");
        assert.equal(body.code, "CASE_USED_BY_OTHER_TEACHERS");
        assert.equal(ranDelete(), false);
        assert.deepEqual(transactionEnd(), ["ROLLBACK"]);
        assert.equal(await exists(caseDirectory), true);
        assertConnectionsReleased();
    });

    it("keeps the upload directory while another case still references a file in it", async () => {
        state.referenced = true;

        const { status } = await deleteCase();

        assert.equal(status, 200);
        assert.ok(ranDelete());
        assert.equal(await exists(path.join(caseDirectory, "case.pdf")), true);
    });

    it("answers 400 for an id that is not a positive integer", async () => {
        const { status } = await deleteCase({ caseId: "abc" });

        assert.equal(status, 400);
        assert.deepEqual(statements(), []);
    });

    it("answers 500 and rolls back for a database error, keeping the files", async () => {
        state.failDelete = true;

        const { status, body } = await deleteCase();

        assert.equal(status, 500);
        assert.equal(body.status, "err");
        assert.equal(body.code, undefined);
        assert.deepEqual(transactionEnd(), ["ROLLBACK"]);
        assert.equal(await exists(caseDirectory), true);
        assertConnectionsReleased();
    });
});

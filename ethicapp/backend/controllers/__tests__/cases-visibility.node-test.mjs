// PATCH /cases/:id/visibility checks ownership before whether a launched
// activity uses the case, so a teacher who does not own the case gets the
// same 404 as for a missing one, in use or not, and the owner keeps the
// in-use 409 (#929, epic #923). PostgreSQL is a fake pg pool that answers by
// matching the SQL, so nothing here needs a database.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import pg from "pg";

import casesRouter from "../cases.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER_ID = 7;
const OTHER_TEACHER_ID = 8;
const CASE_ID = 41;
const MISSING_CASE_ID = 999;

const state = { inUse: false };

function caseExists(caseId) {
    return Number(caseId) === CASE_ID;
}

const OWNERSHIP_SQL =
    /SELECT id\s+FROM ethical_cases\s+WHERE id = \$1\s+AND creator = \$2\s+FOR UPDATE/u;

function rowsFor(sql, params) {
    if (OWNERSHIP_SQL.test(sql)) {
        const [caseId, uid] = params;
        return caseExists(caseId) && Number(uid) === OWNER_ID ? [{ id: CASE_ID }] : [];
    }
    if (/INNER JOIN activity a ON a\.design = d\.id\s+WHERE d\.case_id = \$1/u.test(sql)) {
        return caseExists(params[0]) && state.inUse ? [{ id: 3 }] : [];
    }
    if (/^\s*UPDATE ethical_cases\b/u.test(sql)) {
        const [visibility, caseId, uid] = params;
        return caseExists(caseId) && Number(uid) === OWNER_ID
            ? [{ id: CASE_ID, visibility, license_code: "CC-BY-4.0" }]
            : [];
    }
    if (/^\s*UPDATE designs\b/u.test(sql)) {
        return [{ id: 12 }];
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

after(() => db.restore());

beforeEach(() => {
    db.reset();
    state.inUse = false;
    connections.taken = 0;
    connections.released = 0;
});

function changeVisibility({ caseId = CASE_ID, uid = OWNER_ID, visibility = "public" } = {}) {
    return requestRouter(casesRouter, {
        method:  "PATCH",
        path:    `/cases/${caseId}/visibility`,
        body:    { visibility },
        session: { uid, role: "P" },
    });
}

function statements() {
    return db.queries.map(query => query.sql.trim());
}

function transactionEnd() {
    return statements().filter(sql => sql === "COMMIT" || sql === "ROLLBACK");
}

function ranLaunchedCheck() {
    return statements().some(sql => /INNER JOIN activity a ON a\.design = d\.id/u.test(sql));
}

function ranCaseUpdate() {
    return statements().some(sql => /^UPDATE ethical_cases\b/u.test(sql));
}

const CASE_NOT_FOUND = { status: "err", message: "Case not found.", code: "CASE_NOT_FOUND" };

describe("PATCH /cases/:id/visibility", () => {
    it("lets the owner change the visibility of a case no launched activity uses", async () => {
        const { status, body } = await changeVisibility({ visibility: "private" });

        assert.equal(status, 200);
        assert.equal(body.result.id, CASE_ID);
        assert.equal(body.result.visibility, "private");
        assert.deepEqual(body.result.affectedDesignIds, [12]);
        assert.ok(ranLaunchedCheck());
        assert.ok(ranCaseUpdate());
        assert.equal(statements()[0], "BEGIN");
        assert.deepEqual(transactionEnd(), ["COMMIT"]);
        assert.equal(connections.released, connections.taken);
    });

    it("answers the owner of a case in use with the in-use 409", async () => {
        state.inUse = true;

        const { status, body } = await changeVisibility();

        assert.equal(status, 409);
        assert.equal(body.code, "CASE_USED_BY_LAUNCHED_ACTIVITY");
        assert.equal(ranCaseUpdate(), false);
        assert.deepEqual(transactionEnd(), ["ROLLBACK"]);
        assert.equal(connections.released, connections.taken);
    });

    it("answers a teacher who does not own a case not in use with 404", async () => {
        const { status, body } = await changeVisibility({ uid: OTHER_TEACHER_ID });

        assert.equal(status, 404);
        assert.deepEqual(body, CASE_NOT_FOUND);
        assert.equal(ranLaunchedCheck(), false);
        assert.equal(ranCaseUpdate(), false);
        assert.deepEqual(transactionEnd(), ["ROLLBACK"]);
        assert.equal(connections.released, connections.taken);
    });

    it("answers a teacher who does not own a case in use with the same 404", async () => {
        const notInUse = await changeVisibility({ uid: OTHER_TEACHER_ID });
        db.reset();
        state.inUse = true;

        const inUse = await changeVisibility({ uid: OTHER_TEACHER_ID });

        assert.equal(inUse.status, 404);
        assert.deepEqual(inUse, notInUse);
        assert.equal(ranLaunchedCheck(), false);
        assert.deepEqual(transactionEnd(), ["ROLLBACK"]);
        assert.equal(connections.released, connections.taken);
    });

    it("answers a missing case with the same 404", async () => {
        const missing = await changeVisibility({ caseId: MISSING_CASE_ID });
        const notOwned = await changeVisibility({ uid: OTHER_TEACHER_ID });

        assert.equal(missing.status, 404);
        assert.deepEqual(missing.body, CASE_NOT_FOUND);
        assert.deepEqual(missing, notOwned);
        assert.equal(connections.released, connections.taken);
    });

    it("checks ownership inside the transaction, locking the case row", async () => {
        await changeVisibility();

        const sqls = statements();
        const ownershipIndex = sqls.findIndex(sql => /FOR UPDATE;?$/u.test(sql));
        assert.ok(ownershipIndex > sqls.indexOf("BEGIN"));
        assert.deepEqual(db.queries[ownershipIndex].params, [CASE_ID, OWNER_ID]);
        const launchedIndex = sqls.findIndex(sql => /INNER JOIN activity a/u.test(sql));
        assert.ok(ownershipIndex < launchedIndex);
    });
});

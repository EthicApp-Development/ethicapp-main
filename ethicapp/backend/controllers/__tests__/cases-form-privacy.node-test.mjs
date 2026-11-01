// The case form, PATCH /cases/:id, applies a private visibility to the public
// designs that use the case, in the transaction that writes the case, as
// PATCH /cases/:id/visibility does (#934, epic #923). Otherwise a public
// design would keep the private case, its PDF and its rendered pages readable
// by everyone. A teacher who does not own the case gets the same 404 as for a
// missing one, and a case a launched activity uses keeps the in-use 409.
// PostgreSQL is a fake pg pool that answers by matching the SQL, so nothing
// here needs a database.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import pg from "pg";

import casesRouter from "../cases.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER_ID = 7;
const OTHER_TEACHER_ID = 8;
const CASE_ID = 41;
const MISSING_CASE_ID = 999;

const state = {
    inUse:            false,
    storedVisibility: "public",
    publicDesignIds:  [],
    caseGone:         false,
    failDesigns:      false,
    // The creator of each design that uses the case (#939).
    designCreators:   [],
};

// A teacher id that must never reach the owner's answer (#939).
const DESIGN_TEACHER_ID = 9017;

const COUNT_SQL = /SELECT COUNT\(\*\)::int AS count\s+FROM designs\s+WHERE case_id = \$1/u;

// The fake's answer to the count of designs that keep the case (#939).
function designsKeepingAccess(caseId, ownerId) {
    if (Number(caseId) !== CASE_ID) {
        return 0;
    }
    return state.designCreators
        .filter(creator => creator !== null && creator !== Number(ownerId))
        .length;
}

function isOwnedCase(caseId, uid) {
    return Number(caseId) === CASE_ID && Number(uid) === OWNER_ID;
}

const EXISTING_CASE_SQL = /SELECT id, pdf_path, visibility, license_code/u;
const LAUNCHED_SQL = /INNER JOIN activity a ON a\.design = d\.id\s+WHERE d\.case_id = \$1/u;
const CASE_UPDATE_SQL = /^\s*UPDATE ethical_cases\b/u;
const DESIGNS_UPDATE_SQL = /^\s*UPDATE designs\b/u;

function caseRow(visibility) {
    return {
        id:               CASE_ID,
        case_uuid:        "00000000-0000-4000-8000-000000000041",
        title:            "A case",
        author_firstname: "Ada",
        author_lastname:  "Lovelace",
        author_email:     "ada@example.com",
        pdf_path:         null,
        creator:          OWNER_ID,
        visibility,
        license_code:     "CC-BY-4.0",
        language_code:    "es_CL",
    };
}

function rowsFor(sql, params) {
    if (EXISTING_CASE_SQL.test(sql)) {
        const [caseId, uid] = params;
        return isOwnedCase(caseId, uid)
            ? [{ id: CASE_ID, pdf_path: null, visibility: state.storedVisibility }]
            : [];
    }
    if (LAUNCHED_SQL.test(sql)) {
        return Number(params[0]) === CASE_ID && state.inUse ? [{ id: 3 }] : [];
    }
    if (CASE_UPDATE_SQL.test(sql)) {
        const caseId = params[5];
        const uid = params[6];
        const visibility = params[7];
        return isOwnedCase(caseId, uid) && !state.caseGone ? [caseRow(visibility)] : [];
    }
    if (DESIGNS_UPDATE_SQL.test(sql)) {
        if (state.failDesigns) {
            throw new Error("designs update failed");
        }
        return Number(params[0]) === CASE_ID ? state.publicDesignIds.map(id => ({ id })) : [];
    }
    if (COUNT_SQL.test(sql)) {
        return [{ count: designsKeepingAccess(params[0], params[1]) }];
    }
    if (/INSERT INTO ethical_case_author \(/u.test(sql)) {
        return [{ id: 5 }];
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
    state.storedVisibility = "public";
    state.publicDesignIds = [];
    state.caseGone = false;
    state.failDesigns = false;
    state.designCreators = [];
    connections.taken = 0;
    connections.released = 0;
});

function saveCaseForm({ caseId = CASE_ID, uid = OWNER_ID, visibility = "private" } = {}) {
    return requestRouter(casesRouter, {
        method: "PATCH",
        path:   `/cases/${caseId}`,
        body:   {
            title:   "A case",
            authors: JSON.stringify([{
                authorFirstname: "Ada", authorLastname: "Lovelace", authorEmail: "ada@example.com",
            }]),
            visibility,
        },
        session: { uid, role: "P" },
    });
}

function statements() {
    return db.queries.map(query => query.sql.trim());
}

function indexOf(pattern) {
    return statements().findIndex(sql => pattern.test(sql));
}

function ran(pattern) {
    return indexOf(pattern) !== -1;
}

function isTransactionStatement(sql) {
    return sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK";
}

// The transaction statements around the case update: the BEGIN before it,
// and the COMMIT or ROLLBACK that ends it.
function caseUpdateTransaction() {
    const sqls = statements();
    const updateIndex = indexOf(CASE_UPDATE_SQL);
    const begin = sqls.slice(0, updateIndex).findLastIndex(isTransactionStatement);
    const endOffset = sqls.slice(updateIndex).findIndex(isTransactionStatement);
    return {
        begin,
        opener: sqls[begin],
        end:    updateIndex + endOffset,
        closer: sqls[updateIndex + endOffset],
    };
}

const CASE_NOT_FOUND = { status: "err", message: "Case not found.", code: "CASE_NOT_FOUND" };

describe("PATCH /cases/:id making the case private", () => {
    it("turns the public designs that use the case private and reports them", async () => {
        state.publicDesignIds = [12, 13];

        const { status, body } = await saveCaseForm({ visibility: "private" });

        assert.equal(status, 200);
        assert.equal(body.result.id, CASE_ID);
        assert.equal(body.result.visibility, "private");
        assert.equal(body.result.public, false);
        assert.deepEqual(body.result.affectedDesignIds, [12, 13]);
        assert.equal(db.queries[indexOf(CASE_UPDATE_SQL)].params[7], "private");
        assert.deepEqual(db.queries[indexOf(DESIGNS_UPDATE_SQL)].params, [CASE_ID]);
        assert.equal(connections.released, connections.taken);
    });

    it("writes the case and its designs in one transaction", async () => {
        state.publicDesignIds = [12];

        await saveCaseForm({ visibility: "private" });

        const transaction = caseUpdateTransaction();
        const designsIndex = indexOf(DESIGNS_UPDATE_SQL);
        assert.equal(transaction.opener, "BEGIN");
        assert.equal(transaction.closer, "COMMIT");
        assert.ok(transaction.begin < indexOf(CASE_UPDATE_SQL));
        assert.ok(indexOf(CASE_UPDATE_SQL) < designsIndex);
        assert.ok(designsIndex < transaction.end);
    });

    it("reports no designs when no public design uses the case", async () => {
        const { status, body } = await saveCaseForm({ visibility: "private" });

        assert.equal(status, 200);
        assert.equal(body.result.visibility, "private");
        assert.deepEqual(body.result.affectedDesignIds, []);
        assert.ok(ran(DESIGNS_UPDATE_SQL));
    });

    it("repairs a public design of a case that was already private", async () => {
        state.storedVisibility = "private";
        state.publicDesignIds = [12];

        const { status, body } = await saveCaseForm({ visibility: "private" });

        assert.equal(status, 200);
        assert.deepEqual(body.result.affectedDesignIds, [12]);
    });

    it("rolls the case back when the designs cannot be updated", async () => {
        state.publicDesignIds = [12];
        state.failDesigns = true;
        const originalError = console.error;
        console.error = () => {};

        try {
            const { status, body } = await saveCaseForm({ visibility: "private" });

            assert.equal(status, 500);
            assert.equal(body.message, "Failed to update case.");
        } finally {
            console.error = originalError;
        }

        const transaction = caseUpdateTransaction();
        assert.equal(transaction.opener, "BEGIN");
        assert.equal(transaction.closer, "ROLLBACK");
        assert.ok(transaction.end > indexOf(DESIGNS_UPDATE_SQL));
        assert.equal(statements().includes("COMMIT"), false);
        assert.equal(ran(/DELETE FROM ethical_cases_authors/u), false);
        assert.equal(connections.released, connections.taken);
    });
});

describe("PATCH /cases/:id making the case public", () => {
    it("leaves the designs untouched and reports none", async () => {
        state.storedVisibility = "private";
        state.publicDesignIds = [12];

        const { status, body } = await saveCaseForm({ visibility: "public" });

        assert.equal(status, 200);
        assert.equal(body.result.visibility, "public");
        assert.equal(body.result.public, true);
        assert.deepEqual(body.result.affectedDesignIds, []);
        assert.equal(ran(DESIGNS_UPDATE_SQL), false);
        assert.equal(caseUpdateTransaction().closer, "COMMIT");
        assert.equal(connections.released, connections.taken);
    });
});

describe("PATCH /cases/:id and the designs that keep the case (#939)", () => {
    function countIndex() {
        return indexOf(COUNT_SQL);
    }

    it("reports none when no design uses the case", async () => {
        const { status, body } = await saveCaseForm({ visibility: "private" });

        assert.equal(status, 200);
        assert.equal(body.result.designsKeepingAccess, 0);
    });

    it("reports none when only the owner's designs use the case", async () => {
        state.publicDesignIds = [12];
        state.designCreators = [OWNER_ID, OWNER_ID];

        const { body } = await saveCaseForm({ visibility: "private" });

        assert.deepEqual(body.result.affectedDesignIds, [12]);
        assert.equal(body.result.designsKeepingAccess, 0);
    });

    it("counts other teachers' designs after the designs update, in the transaction", async () => {
        state.publicDesignIds = [12];
        state.designCreators = [OWNER_ID, OTHER_TEACHER_ID, DESIGN_TEACHER_ID, null];

        const { status, body } = await saveCaseForm({ visibility: "private" });

        assert.equal(status, 200);
        assert.equal(body.result.designsKeepingAccess, 2);
        assert.deepEqual(db.queries[countIndex()].params, [CASE_ID, OWNER_ID]);
        const transaction = caseUpdateTransaction();
        assert.equal(transaction.closer, "COMMIT");
        assert.ok(indexOf(DESIGNS_UPDATE_SQL) < countIndex());
        assert.ok(countIndex() < transaction.end);
    });

    it("reports the count when the case is made public too", async () => {
        state.storedVisibility = "private";
        state.designCreators = [DESIGN_TEACHER_ID];

        const { body } = await saveCaseForm({ visibility: "public" });

        assert.equal(body.result.designsKeepingAccess, 1);
        assert.equal(ran(DESIGNS_UPDATE_SQL), false);
    });

    it("reveals no other teacher in the answer", async () => {
        state.designCreators = [DESIGN_TEACHER_ID, DESIGN_TEACHER_ID, DESIGN_TEACHER_ID];

        const { body } = await saveCaseForm({ visibility: "private" });

        assert.equal(body.result.designsKeepingAccess, 3);
        assert.equal(body.result.creator, OWNER_ID);
        assert.doesNotMatch(JSON.stringify(body), new RegExp(String(DESIGN_TEACHER_ID), "u"));
    });

    it("counts nothing for a refused save", async () => {
        state.designCreators = [DESIGN_TEACHER_ID];

        const notOwned = await saveCaseForm({ uid: OTHER_TEACHER_ID });
        assert.equal(notOwned.status, 404);
        assert.equal(countIndex(), -1);

        db.reset();
        state.inUse = true;
        const inUse = await saveCaseForm();
        assert.equal(inUse.status, 409);
        assert.equal(countIndex(), -1);
    });
});

describe("PATCH /cases/:id on a case a launched activity uses", () => {
    it("refuses any change, the visibility included, with the in-use 409", async () => {
        state.inUse = true;
        state.publicDesignIds = [12];

        const { status, body } = await saveCaseForm({ visibility: "private" });

        assert.equal(status, 409);
        assert.equal(body.code, "CASE_USED_BY_LAUNCHED_ACTIVITY");
        assert.equal(ran(CASE_UPDATE_SQL), false);
        assert.equal(ran(DESIGNS_UPDATE_SQL), false);
        assert.equal(statements().includes("BEGIN"), false);
        assert.equal(connections.released, connections.taken);
    });
});

describe("PATCH /cases/:id by a teacher who does not own the case", () => {
    it("answers 404 CASE_NOT_FOUND before the in-use check and writes nothing", async () => {
        state.publicDesignIds = [12];

        const { status, body } = await saveCaseForm({ uid: OTHER_TEACHER_ID });

        assert.equal(status, 404);
        assert.deepEqual(body, CASE_NOT_FOUND);
        assert.equal(ran(LAUNCHED_SQL), false);
        assert.equal(ran(CASE_UPDATE_SQL), false);
        assert.equal(ran(DESIGNS_UPDATE_SQL), false);
        assert.equal(connections.released, connections.taken);
    });

    it("answers the same 404 whether a launched activity uses the case or not", async () => {
        const notInUse = await saveCaseForm({ uid: OTHER_TEACHER_ID });
        state.inUse = true;

        const inUse = await saveCaseForm({ uid: OTHER_TEACHER_ID });

        assert.deepEqual(inUse, notInUse);
    });

    it("answers the same 404 as for a missing case", async () => {
        const missing = await saveCaseForm({ caseId: MISSING_CASE_ID });
        const notOwned = await saveCaseForm({ uid: OTHER_TEACHER_ID });

        assert.deepEqual(missing.body, CASE_NOT_FOUND);
        assert.deepEqual(missing, notOwned);
    });

    it("answers 404 when the case is gone by the time it is written", async () => {
        state.caseGone = true;
        state.publicDesignIds = [12];

        const { status, body } = await saveCaseForm({ visibility: "private" });

        assert.equal(status, 404);
        assert.deepEqual(body, CASE_NOT_FOUND);
        assert.equal(ran(DESIGNS_UPDATE_SQL), false);
        assert.equal(connections.released, connections.taken);
    });
});

// DELETE /designs/:id (#963, epic #966). A design an activity uses answers
// 409 DESIGN_IN_USE and nothing is deleted; any other design of the teacher's
// is deleted, its copies included in the database's ON DELETE SET NULL (V37).
// A missing design and another teacher's design keep their shared 404 (#929).
// PostgreSQL is a fake pg pool that answers by matching the SQL, so nothing
// here needs a database.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import designsRouter from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER_ID = 7;
const OTHER_TEACHER_ID = 8;

const FREE_DESIGN_ID = 20;
const USED_DESIGN_ID = 21;
const LAUNCHED_DURING_DELETE_ID = 22;
const OTHER_DESIGN_ID = 23;
const MISSING_DESIGN_ID = 999;

const designs = new Map([
    [FREE_DESIGN_ID, { id: FREE_DESIGN_ID, creator: OWNER_ID, in_use: false }],
    [USED_DESIGN_ID, { id: USED_DESIGN_ID, creator: OWNER_ID, in_use: true }],
    // Free when read, used by an activity by the time the DELETE runs.
    [LAUNCHED_DURING_DELETE_ID, {
        id:      LAUNCHED_DURING_DELETE_ID,
        creator: OWNER_ID,
        in_use:  false,
    }],
    [OTHER_DESIGN_ID, { id: OTHER_DESIGN_ID, creator: OTHER_TEACHER_ID, in_use: false }],
]);

let failDelete = false;

function rowsFor(sql, params = []) {
    const designId = Number(params[0]);
    if (/^\s*SELECT\b[\s\S]*\bFROM designs\s+WHERE id = \$1\b/u.test(sql)) {
        const design = designs.get(designId);
        return design ? [design] : [];
    }
    if (/^\s*DELETE FROM designs\b/u.test(sql)) {
        if (failDelete) {
            throw new Error("connection lost");
        }
        const design = designs.get(designId);
        const usedNow = design?.in_use || designId === LAUNCHED_DURING_DELETE_ID;
        return design && !usedNow ? [{ id: design.id }] : [];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => db.restore());

beforeEach(() => {
    db.reset();
    failDelete = false;
});

function deletes() {
    return db.queries
        .map(query => query.sql.trim())
        .filter(sql => /^DELETE\b/u.test(sql));
}

async function deleteDesign(designId, uid = OWNER_ID) {
    return requestRouter(designsRouter, {
        method:  "DELETE",
        path:    `/designs/${designId}`,
        session: { uid, role: "P" },
    });
}

const DESIGN_NOT_FOUND = { status: 404, body: { status: "err", message: "Design not found" } };

describe("DELETE /designs/:id", () => {
    it("deletes the owner's design no activity uses", async () => {
        const { status, body } = await deleteDesign(FREE_DESIGN_ID);

        assert.equal(status, 200);
        assert.equal(body.status, "ok");
        assert.equal(deletes().length, 1);
        assert.match(deletes()[0],
            /NOT EXISTS \(SELECT 1 FROM activity a WHERE a\.design = \$1\)/u);
    });

    it("answers 409 DESIGN_IN_USE for a design an activity uses, and deletes nothing", async () => {
        const { status, body } = await deleteDesign(USED_DESIGN_ID);

        assert.equal(status, 409);
        assert.equal(body.status, "err");
        assert.equal(body.code, "DESIGN_IN_USE");
        assert.deepEqual(deletes(), []);
    });

    it("answers 409 DESIGN_IN_USE when an activity uses the design by the DELETE", async () => {
        const { status, body } = await deleteDesign(LAUNCHED_DURING_DELETE_ID);

        assert.equal(status, 409);
        assert.equal(body.code, "DESIGN_IN_USE");
    });

    it("answers a missing design and another teacher's design with one 404", async () => {
        assert.deepEqual(await deleteDesign(MISSING_DESIGN_ID), DESIGN_NOT_FOUND);
        assert.deepEqual(await deleteDesign(OTHER_DESIGN_ID), DESIGN_NOT_FOUND);
        assert.deepEqual(deletes(), []);
    });

    it("answers 400 for an id that is not a number", async () => {
        const { status } = await deleteDesign("abc");

        assert.equal(status, 400);
        assert.deepEqual(deletes(), []);
    });

    it("answers 500 for an unexpected database error", async () => {
        failDelete = true;
        const { status, body } = await deleteDesign(FREE_DESIGN_ID);

        assert.equal(status, 500);
        assert.equal(body.status, "err");
        assert.equal(body.code, undefined);
    });
});

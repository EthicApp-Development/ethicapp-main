// GET /designs/:id/valid answers only for a design the teacher may read under
// GET /designs/:id's rule, their own or a public one, and gives any other
// design the same 404 as a missing one (#929, epic #923). PostgreSQL is a fake
// pg pool that applies the readable-design condition when the SQL carries it,
// so a query without the condition would leak the row.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import designsRouter from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const TEACHER_ID = 7;
const OTHER_TEACHER_ID = 8;
const STUDENT_ID = 30;

const OWN_DESIGN_ID = 12;
const PUBLIC_DESIGN_ID = 13;
const PRIVATE_DESIGN_ID = 14;
const MISSING_DESIGN_ID = 999;

const designs = new Map([
    [OWN_DESIGN_ID, { creator: TEACHER_ID, visibility: "private", valid: "true" }],
    [PUBLIC_DESIGN_ID, { creator: OTHER_TEACHER_ID, visibility: "public", valid: "false" }],
    [PRIVATE_DESIGN_ID, { creator: OTHER_TEACHER_ID, visibility: "private", valid: "true" }],
]);

const READABLE_CONDITION = /AND \(creator = \$2 OR visibility = 'public'\)/u;

function rowsFor(sql, params) {
    if (!/design ->> 'valid' AS valid\s+FROM designs/u.test(sql)) {
        return [];
    }
    const [designId, uid] = params;
    const design = designs.get(Number(designId));
    if (!design) {
        return [];
    }
    const readable = sameId(design.creator, uid) || design.visibility === "public";
    if (READABLE_CONDITION.test(sql) && !readable) {
        return [];
    }
    return [{ id: Number(designId), valid: design.valid }];
}

function sameId(left, right) {
    return Number(left) === Number(right);
}

const db = installFakePgPool(rowsFor);

after(() => db.restore());

beforeEach(() => db.reset());

function checkValidity(designId, session = { uid: TEACHER_ID, role: "P" }) {
    return requestRouter(designsRouter, { path: `/designs/${designId}/valid`, session });
}

function validityQueries() {
    return db.queries.filter(query => /design ->> 'valid'/u.test(query.sql));
}

describe("GET /designs/:id/valid", () => {
    it("answers the validity of the teacher's own design", async () => {
        const { status, body } = await checkValidity(OWN_DESIGN_ID);

        assert.equal(status, 200);
        assert.deepEqual(body, { status: "ok", valid: true });
        const [query] = validityQueries();
        assert.match(query.sql, READABLE_CONDITION);
        assert.deepEqual(query.params, [OWN_DESIGN_ID, TEACHER_ID]);
    });

    it("answers the validity of another teacher's public design", async () => {
        const { status, body } = await checkValidity(PUBLIC_DESIGN_ID);

        assert.equal(status, 200);
        assert.deepEqual(body, { status: "ok", valid: false });
    });

    it("answers another teacher's private design as a missing one", async () => {
        const privateDesign = await checkValidity(PRIVATE_DESIGN_ID);
        const missingDesign = await checkValidity(MISSING_DESIGN_ID);

        assert.equal(privateDesign.status, 404);
        assert.deepEqual(privateDesign.body, { status: "err", message: "Design not found" });
        assert.deepEqual(privateDesign, missingDesign);
    });

    it("answers a missing design with 404", async () => {
        const { status, body } = await checkValidity(MISSING_DESIGN_ID);

        assert.equal(status, 404);
        assert.deepEqual(body, { status: "err", message: "Design not found" });
    });

    it("refuses a student with 403 before any lookup, whatever the design", async () => {
        const student = { uid: STUDENT_ID, role: "A" };
        const answers = await Promise.all([
            checkValidity(OWN_DESIGN_ID, student),
            checkValidity(PUBLIC_DESIGN_ID, student),
            checkValidity(PRIVATE_DESIGN_ID, student),
            checkValidity(MISSING_DESIGN_ID, student),
        ]);

        for (const answer of answers) {
            assert.equal(answer.status, 403);
            assert.deepEqual(answer, answers[0]);
        }
        assert.equal(validityQueries().length, 0);
    });

    it("refuses a request without a session with 401 before any lookup", async () => {
        const { status } = await checkValidity(OWN_DESIGN_ID, {});

        assert.equal(status, 401);
        assert.equal(validityQueries().length, 0);
    });
});

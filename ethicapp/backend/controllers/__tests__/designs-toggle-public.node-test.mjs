// PATCH /designs/:id/toggle_public changes only the design's visibility
// (#1009). A design whose case is private is refused with 409
// CASE_VISIBILITY_REQUIRED whatever the body says: the route never publishes
// the case, never copies it and never changes the design's case_id, so it
// cannot bypass the case endpoints' rules or repoint a design that activities
// use. PostgreSQL is a fake pg pool that answers the design lookup from the
// fixtures below, so nothing here needs a database.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import designsRouter from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const TEACHER = Object.freeze({ uid: 7, role: "P" });
const OTHER_TEACHER_ID = 8;

const OWN_PRIVATE_CASE = 41;
const OTHER_PRIVATE_CASE = 43;
const PUBLIC_CASE = 42;

// Private designs whose case is private: the teacher's own case (what
// `publishCase` used to publish) and another teacher's case (what
// `publishCaseCopy` used to copy).
const OWN_CASE_DESIGN_ID = 12;
const OTHER_CASE_DESIGN_ID = 13;
const PUBLIC_CASE_DESIGN_ID = 14;
// A public design whose case has been made private since.
const PUBLISHED_DESIGN_ID = 15;
const NO_CASE_DESIGN_ID = 16;

const cases = new Map([
    [OWN_PRIVATE_CASE, { creator: TEACHER.uid, visibility: "private" }],
    [OTHER_PRIVATE_CASE, { creator: OTHER_TEACHER_ID, visibility: "private" }],
    [PUBLIC_CASE, { creator: OTHER_TEACHER_ID, visibility: "public" }],
]);

const designs = new Map([
    [OWN_CASE_DESIGN_ID, { visibility: "private", case_id: OWN_PRIVATE_CASE }],
    [OTHER_CASE_DESIGN_ID, { visibility: "private", case_id: OTHER_PRIVATE_CASE }],
    [PUBLIC_CASE_DESIGN_ID, { visibility: "private", case_id: PUBLIC_CASE }],
    [PUBLISHED_DESIGN_ID, { visibility: "public", case_id: OWN_PRIVATE_CASE }],
    [NO_CASE_DESIGN_ID, { visibility: "private", case_id: null }],
]);

const DESIGN_LOOKUP = /FROM designs d\s+LEFT JOIN ethical_cases c[\s\S]*FOR UPDATE OF d/u;

// The design row joined with its case, as the route reads it.
function rowsFor(sql, params = []) {
    if (DESIGN_LOOKUP.test(sql)) {
        const design = designs.get(Number(params[0]));
        if (!design) {
            return [];
        }
        const designCase = cases.get(design.case_id);
        return [{
            id:                Number(params[0]),
            creator:           TEACHER.uid,
            visibility:        design.visibility,
            license_code:      "CC-BY-4.0",
            case_id:           design.case_id,
            case_creator:      designCase?.creator ?? null,
            case_visibility:   designCase?.visibility ?? null,
            case_license_code: designCase ? "CC-BY-4.0" : null,
        }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => db.restore());

beforeEach(() => db.reset());

function togglePublic(designId, body) {
    return requestRouter(designsRouter, {
        method:  "PATCH",
        path:    `/designs/${designId}/toggle_public`,
        body,
        session: TEACHER,
    });
}

const normalize = sql => sql.replace(/\s+/gu, " ").trim();

function statements() {
    return db.queries.map(query => normalize(query.sql));
}

function designUpdates() {
    return db.queries.filter(query => /^\s*UPDATE designs\b/u.test(query.sql));
}

// Neither the case nor the design's case is touched: no write to
// ethical_cases, no case copy, and no write to the design at all.
function assertNothingWritten() {
    const sqls = statements();
    assert.ok(!sqls.some(sql => /\bethical_cases\b/u.test(sql) && !DESIGN_LOOKUP.test(sql)),
        "the case is neither read for a copy nor updated");
    assert.ok(!sqls.some(sql => /^(INSERT|UPDATE|DELETE)\b/u.test(sql)), "nothing is written");
    assert.ok(!sqls.some(sql => /nextval/u.test(sql)), "no case copy is made");
    assert.equal(sqls.at(-1), "ROLLBACK");
    assert.ok(!sqls.includes("COMMIT"));
}

function assertCaseVisibilityRequired({ status, body }) {
    assert.equal(status, 409, JSON.stringify(body));
    assert.equal(body.status, "err");
    assert.equal(body.code, "CASE_VISIBILITY_REQUIRED");
    assertNothingWritten();
}

// The one write of a successful toggle: the design's visibility, nothing else.
function assertVisibilityWritten(designId, visibility) {
    const updates = designUpdates();
    assert.equal(updates.length, 1);
    const [update] = updates;
    assert.ok(!/case_id/u.test(update.sql), "the design's case_id is not written");
    assert.deepEqual(update.params, [visibility, visibility === "public", designId]);
    const caseWrite = /^(INSERT|UPDATE|DELETE)\b[\s\S]*\bethical_cases\b/u;
    assert.ok(!statements().some(sql => caseWrite.test(sql)), "the case is not changed");
    assert.equal(statements().at(-1), "COMMIT");
}

describe("PATCH /designs/:id/toggle_public refuses a private case (#1009)", () => {
    for (const [label, body] of [
        ["without a body", undefined],
        ["with an empty body", {}],
        ["with publishCase", { publishCase: true }],
        ["with publishCaseCopy", { publishCaseCopy: true }],
        ["with both flags", { publishCase: true, publishCaseCopy: true }],
    ]) {
        it(`refuses the teacher's own private case ${label}`, async () => {
            assertCaseVisibilityRequired(await togglePublic(OWN_CASE_DESIGN_ID, body));
        });

        it(`refuses another teacher's private case ${label}`, async () => {
            assertCaseVisibilityRequired(await togglePublic(OTHER_CASE_DESIGN_ID, body));
        });
    }
});

describe("PATCH /designs/:id/toggle_public changes only the design's visibility", () => {
    it("publishes a design whose case is public", async () => {
        const { status, body } = await togglePublic(PUBLIC_CASE_DESIGN_ID);

        assert.equal(status, 200, JSON.stringify(body));
        assert.deepEqual(body.result, {
            id:         PUBLIC_CASE_DESIGN_ID,
            visibility: "public",
            public:     true,
            caseId:     PUBLIC_CASE,
        });
        assertVisibilityWritten(PUBLIC_CASE_DESIGN_ID, "public");
    });

    it("ignores the old flags on a design whose case is public", async () => {
        const { status, body } = await togglePublic(PUBLIC_CASE_DESIGN_ID, {
            publishCaseCopy: true,
        });

        assert.equal(status, 200, JSON.stringify(body));
        assert.equal(body.result.caseId, PUBLIC_CASE);
        assertVisibilityWritten(PUBLIC_CASE_DESIGN_ID, "public");
        assert.ok(!statements().some(sql => /nextval/u.test(sql)), "no case copy is made");
    });

    it("publishes a design without a case", async () => {
        const { status, body } = await togglePublic(NO_CASE_DESIGN_ID);

        assert.equal(status, 200, JSON.stringify(body));
        assert.equal(body.result.visibility, "public");
        assert.equal(body.result.caseId, null);
        assertVisibilityWritten(NO_CASE_DESIGN_ID, "public");
    });

    it("unpublishes a public design, even when its case is private", async () => {
        const { status, body } = await togglePublic(PUBLISHED_DESIGN_ID);

        assert.equal(status, 200, JSON.stringify(body));
        assert.deepEqual(body.result, {
            id:         PUBLISHED_DESIGN_ID,
            visibility: "private",
            public:     false,
            caseId:     OWN_PRIVATE_CASE,
        });
        assertVisibilityWritten(PUBLISHED_DESIGN_ID, "private");
    });
});

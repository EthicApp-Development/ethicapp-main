// GET /cases/:id/uses (#1012, epic #1008): the designs that use a case, for a
// teacher who can read it. The teacher's own designs come by id and title;
// other teachers' designs only as counts, and only to the case's author
// (#923). A student is refused with 403, and a case the teacher cannot read
// answers like a missing one. PostgreSQL is a fake pg pool that answers from
// a small in-memory world by matching the SQL, so nothing here needs a
// database; the SQL itself is checked in case-usage.integration-test.mjs.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import casesRouter from "../cases.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const AUTHOR_ID = 7;
const COLLEAGUE_ID = 8;
const ANOTHER_COLLEAGUE_ID = 9;
const NEWCOMER_ID = 10;
const STUDENT_ID = 50;

const PUBLIC_CASE_ID = 41;
const PRIVATE_CASE_ID = 43;
const MISSING_CASE_ID = 999;

const cases = [
    { id: PUBLIC_CASE_ID, creator: AUTHOR_ID, visibility: "public" },
    { id: PRIVATE_CASE_ID, creator: COLLEAGUE_ID, visibility: "private" },
];

// The designs that use the cases, with the number of activities launched
// from each. Ids and titles of other teachers' designs must never reach
// another teacher.
function design(id, creator, caseId, title, { archived = false, activities = 0 } = {}) {
    return { id, creator, caseId, title, archived, activities };
}

const designs = [
    design(101, AUTHOR_ID, PUBLIC_CASE_ID, "Author current", { activities: 2 }),
    design(102, AUTHOR_ID, PUBLIC_CASE_ID, "Author archived", { archived: true, activities: 1 }),
    design(201, COLLEAGUE_ID, PUBLIC_CASE_ID, "Colleague secret", { activities: 3 }),
    design(202, COLLEAGUE_ID, PUBLIC_CASE_ID, "Colleague old", { archived: true }),
    design(301, ANOTHER_COLLEAGUE_ID, PUBLIC_CASE_ID, "Another secret", { activities: 4 }),
    // A design without a creator: another teacher's design, but no teacher
    // keeps the case through it (#939).
    design(401, null, PUBLIC_CASE_ID, "Orphan secret"),
    design(501, COLLEAGUE_ID, PRIVATE_CASE_ID, "Private case design", { activities: 1 }),
];

const READABLE_SQL = /FROM ethical_cases c[\s\S]*WHERE c\.id = \$1\s+AND \(\s+c\.creator = \$2/u;
const USES_SQL = /AS own_designs,[\s\S]*AS case_usage\s+FROM ethical_cases c\s+WHERE c\.id = \$1;/u;
const KEEPING_ACCESS_SQL =
    /SELECT COUNT\(\*\)::int AS count\s+FROM designs\s+WHERE case_id = \$1\s+AND creator <> \$2/u;

function caseDesigns(caseId) {
    return designs.filter(design => design.caseId === Number(caseId));
}

// The fake's version of the case read rules: the author, a public case, or a
// case one of the teacher's designs uses.
function readableCase(caseId, uid) {
    const found = cases.find(row => row.id === Number(caseId));
    if (!found) {
        return null;
    }
    const readable = found.creator === Number(uid)
        || found.visibility === "public"
        || caseDesigns(caseId).some(design => design.creator === Number(uid));
    return readable ? found : null;
}

function sum(list, pick) {
    return list.reduce((total, item) => total + pick(item), 0);
}

function usesRow(caseId, uid) {
    const all = caseDesigns(caseId);
    const own = all.filter(design => design.creator === Number(uid));
    const others = all.filter(design => design.creator !== Number(uid));
    return {
        own_designs: own
            .toSorted((a, b) => Number(a.archived) - Number(b.archived) || b.id - a.id)
            .map(({ id, title, archived }) => ({ id, title, archived })),
        case_usage: {
            activityCount:     sum(all, design => design.activities),
            ownActivityCount:  sum(own, design => design.activities),
            ownDesignCount:    own.length,
            otherDesignCount:  others.length,
            otherTeacherCount: new Set(others.map(design => design.creator).filter(Boolean)).size,
        },
    };
}

function rowsFor(sql, params) {
    if (READABLE_SQL.test(sql)) {
        const found = readableCase(params[0], params[1]);
        return found ? [found] : [];
    }
    if (USES_SQL.test(sql)) {
        return [usesRow(params[0], params[1])];
    }
    if (KEEPING_ACCESS_SQL.test(sql)) {
        const [caseId, ownerId] = params;
        const count = caseDesigns(caseId)
            .filter(design => design.creator !== null && design.creator !== Number(ownerId))
            .length;
        return [{ count }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => db.restore());

beforeEach(() => db.reset());

function getUses({ caseId = PUBLIC_CASE_ID, uid = AUTHOR_ID, role = "P" } = {}) {
    return requestRouter(casesRouter, {
        method:  "GET",
        path:    `/cases/${caseId}/uses`,
        session: { uid, role },
    });
}

function ran(pattern) {
    return db.queries.some(({ sql }) => pattern.test(sql));
}

// Neither another teacher's design id nor its title appears in the answer.
function assertNoOtherTeachersDesigns(body, uid) {
    const text = JSON.stringify(body);
    for (const design of designs.filter(row => row.creator !== uid)) {
        assert.equal(text.includes(design.title), false, `leaks "${design.title}"`);
    }
    const ids = body.result.ownDesigns.map(design => design.id);
    const ownIds = designs.filter(row => row.creator === uid).map(row => row.id);
    assert.ok(ids.every(id => ownIds.includes(id)));
}

const CASE_NOT_FOUND = { status: "err", message: "Case not found.", code: "CASE_NOT_FOUND" };

describe("GET /cases/:id/uses", () => {
    it("gives the author their designs and the counts of other teachers' designs", async () => {
        const { status, body } = await getUses();

        assert.equal(status, 200);
        assert.deepEqual(body, {
            status: "ok",
            result: {
                ownDesigns: [
                    { id: 101, title: "Author current", archived: false },
                    { id: 102, title: "Author archived", archived: true },
                ],
                // Every activity, whoever's design it was launched from.
                activityCount:        10,
                otherDesignCount:     4,
                otherTeacherCount:    2,
                // The design without a creator keeps nobody reading the case.
                designsKeepingAccess: 3,
            },
        });
        assertNoOtherTeachersDesigns(body, AUTHOR_ID);
    });

    it("counts the designs keeping the case for the author, leaving the author's out", async () => {
        await getUses();

        const query = db.queries.find(({ sql }) => KEEPING_ACCESS_SQL.test(sql));
        assert.deepEqual(query.params, [PUBLIC_CASE_ID, AUTHOR_ID]);
    });

    it("selects the uses for the reading teacher", async () => {
        await getUses({ uid: COLLEAGUE_ID });

        const query = db.queries.find(({ sql }) => USES_SQL.test(sql));
        assert.deepEqual(query.params, [PUBLIC_CASE_ID, COLLEAGUE_ID]);
    });

    it("gives another teacher reading a public case only their own designs", async () => {
        const { status, body } = await getUses({ uid: COLLEAGUE_ID });

        assert.equal(status, 200);
        assert.deepEqual(body.result, {
            ownDesigns: [
                { id: 201, title: "Colleague secret", archived: false },
                { id: 202, title: "Colleague old", archived: true },
            ],
            activityCount: 3,
        });
        assertNoOtherTeachersDesigns(body, COLLEAGUE_ID);
        assert.equal(ran(KEEPING_ACCESS_SQL), false);
    });

    it("gives a teacher with no design of a public case an empty list", async () => {
        const { status, body } = await getUses({ uid: NEWCOMER_ID });

        assert.equal(status, 200);
        assert.deepEqual(body.result, { ownDesigns: [], activityCount: 0 });
        assert.equal(ran(KEEPING_ACCESS_SQL), false);
    });

    it("answers another teacher's private case like a missing one", async () => {
        const notReadable = await getUses({ caseId: PRIVATE_CASE_ID, uid: AUTHOR_ID });
        const missing = await getUses({ caseId: MISSING_CASE_ID, uid: AUTHOR_ID });

        assert.deepEqual(notReadable, { status: 404, body: CASE_NOT_FOUND });
        assert.deepEqual(missing, { status: 404, body: CASE_NOT_FOUND });
        assert.equal(ran(USES_SQL), false);
        assert.equal(ran(KEEPING_ACCESS_SQL), false);
    });

    it("refuses a student before reading the case", async () => {
        const { status, body } = await getUses({ uid: STUDENT_ID, role: "A" });

        assert.deepEqual({ status, body }, {
            status: 403,
            body:   { status: "err", message: "Forbidden" },
        });
        assert.equal(db.queries.length, 0);
    });

    it("refuses a request without a session", async () => {
        const { status } = await requestRouter(casesRouter, {
            method:  "GET",
            path:    `/cases/${PUBLIC_CASE_ID}/uses`,
            session: {},
        });

        assert.equal(status, 401);
        assert.equal(db.queries.length, 0);
    });

    it("rejects an invalid case id before reading the case", async () => {
        const { status, body } = await getUses({ caseId: "abc" });

        assert.equal(status, 400);
        assert.equal(body.message, "Invalid case id.");
        assert.equal(db.queries.length, 0);
    });
});

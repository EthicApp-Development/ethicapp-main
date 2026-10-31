// Design authoring requires role P (#928): a student session is refused with
// 403 on every design authoring endpoint before anything is read or written,
// while a teacher, or a super-admin impersonating one, passes the role check.
// PostgreSQL is a fake pg pool, so nothing here needs a database.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import designsRouter from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const TEACHER_ID = 7;
const DESIGN_ID = 12;

const STUDENT_SESSION = { uid: 31, role: "A" };
const TEACHER_SESSION = { uid: TEACHER_ID, role: "P" };

const OWNED_DESIGN = {
    id:      DESIGN_ID,
    creator: TEACHER_ID,
    design:  { metainfo: { title: "A design" }, phases: [] },
};

function rowsFor(sql) {
    if (/^\s*SELECT design\s+FROM designs\s+WHERE id = \$1/u.test(sql)) {
        return [{ design: OWNED_DESIGN.design }];
    }
    if (/^\s*SELECT id, creator\s+FROM designs\s+WHERE id = \$1/u.test(sql)) {
        return [{ id: DESIGN_ID, creator: TEACHER_ID }];
    }
    if (/^\s*UPDATE designs\s+SET archived = \$1/u.test(sql)) {
        return [{ id: DESIGN_ID, archived: true }];
    }
    if (/^\s*SELECT DISTINCT ON \(d\.id\)/u.test(sql)) {
        return [{ ...OWNED_DESIGN, user_owned: true, tags: [] }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => db.restore());

beforeEach(() => {
    db.reset();
});

const DESIGN_BODY = { design: { metainfo: { title: "A design" }, phases: [] } };

const AUTHORING_ROUTES = [
    { method: "GET", path: `/designs/${DESIGN_ID}` },
    { method: "POST", path: "/designs", body: DESIGN_BODY },
    { method: "PATCH", path: `/designs/${DESIGN_ID}`, body: DESIGN_BODY },
    { method: "GET", path: "/designs" },
    { method: "PATCH", path: `/designs/${DESIGN_ID}/toggle_public`, body: {} },
    { method: "PATCH", path: `/designs/${DESIGN_ID}/archive`, body: { archived: true } },
    { method: "POST", path: `/designs/${DESIGN_ID}/duplicate`, body: {} },
    { method: "DELETE", path: `/designs/${DESIGN_ID}` },
];

describe("design authoring endpoints require role P", () => {
    for (const route of AUTHORING_ROUTES) {
        it(`refuses a student on ${route.method} ${route.path} before any query`, async () => {
            const { status, body } = await requestRouter(designsRouter, {
                ...route,
                session: STUDENT_SESSION,
            });

            assert.equal(status, 403);
            assert.equal(body.status, "err");
            assert.deepEqual(db.queries, [], "nothing is read or written");
        });
    }

    it("refuses a super-admin who is not impersonating a teacher", async () => {
        const { status } = await requestRouter(designsRouter, {
            method:  "GET",
            path:    "/designs",
            session: { uid: 1, role: "S", authRole: "S" },
        });

        assert.equal(status, 403);
        assert.deepEqual(db.queries, []);
    });

    it("answers 401 without a session user, before any query", async () => {
        const { status } = await requestRouter(designsRouter, {
            method:  "POST",
            path:    "/designs",
            body:    { design: { phases: [] } },
            session: {},
        });

        assert.equal(status, 401);
        assert.deepEqual(db.queries, []);
    });

    it("lets a teacher list designs", async () => {
        const { status, body } = await requestRouter(designsRouter, {
            method:  "GET",
            path:    "/designs",
            session: TEACHER_SESSION,
        });

        assert.equal(status, 200);
        assert.equal(body.result.length, 1);
        assert.deepEqual(db.queries[0].params, [TEACHER_ID]);
    });

    it("lets a teacher read a design", async () => {
        const { status, body } = await requestRouter(designsRouter, {
            method:  "GET",
            path:    `/designs/${DESIGN_ID}`,
            session: TEACHER_SESSION,
        });

        assert.equal(status, 200);
        assert.deepEqual(JSON.parse(body.result), OWNED_DESIGN.design);
    });

    it("lets a teacher archive their design", async () => {
        const { status, body } = await requestRouter(designsRouter, {
            method:  "PATCH",
            path:    `/designs/${DESIGN_ID}/archive`,
            body:    { archived: true },
            session: TEACHER_SESSION,
        });

        assert.equal(status, 200);
        assert.deepEqual(body.result, { id: DESIGN_ID, archived: true });
    });

    it("lets a super-admin impersonating a teacher delete that teacher's design", async () => {
        const { status } = await requestRouter(designsRouter, {
            method:  "DELETE",
            path:    `/designs/${DESIGN_ID}`,
            session: { uid: TEACHER_ID, role: "P", authRole: "S", impersonating: true },
        });

        assert.equal(status, 200);
        assert.ok(
            db.queries.some(query => /^\s*DELETE FROM designs/u.test(query.sql)),
            "the design is deleted"
        );
    });

    it("keeps the ownership check for a teacher who does not own the design", async () => {
        const { status } = await requestRouter(designsRouter, {
            method:  "DELETE",
            path:    `/designs/${DESIGN_ID}`,
            session: { uid: TEACHER_ID + 1, role: "P" },
        });

        assert.equal(status, 403);
        assert.ok(!db.queries.some(query => /^\s*DELETE FROM designs/u.test(query.sql)));
    });
});

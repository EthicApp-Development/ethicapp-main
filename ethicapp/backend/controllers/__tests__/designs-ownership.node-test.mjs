// The design routes that act on a design only its creator may change answer
// another teacher's design with the same 404 as a missing one, so the answer
// does not reveal that the design exists (#929, epic #923). Duplicating also
// accepts another teacher's public, non-archived design. PostgreSQL is a fake
// pg pool that answers by matching the SQL, so nothing here needs a database.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import designsRouter from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const OWNER_ID = 7;
const OTHER_TEACHER_ID = 8;

const OWN_DESIGN_ID = 12;
const OWN_LOCKED_DESIGN_ID = 13;
const OTHER_PRIVATE_DESIGN_ID = 14;
const OTHER_PUBLIC_DESIGN_ID = 15;
const OTHER_ARCHIVED_PUBLIC_DESIGN_ID = 16;
const MISSING_DESIGN_ID = 999;
const COPY_ID = 500;

function designRow(id, { creator, visibility = "private", archived = false, locked = false }) {
    return {
        id,
        creator,
        visibility,
        archived,
        locked,
        public:           visibility === "public",
        design:           { metainfo: { title: `Design ${id}` }, phases: [] },
        license_code:     "CC-BY-4.0",
        attribution_text: null,
        language_code:    "en_US",
        case_id:          null,
    };
}

const designs = new Map([
    [OWN_DESIGN_ID, designRow(OWN_DESIGN_ID, { creator: OWNER_ID })],
    [OWN_LOCKED_DESIGN_ID, designRow(OWN_LOCKED_DESIGN_ID, { creator: OWNER_ID, locked: true })],
    [OTHER_PRIVATE_DESIGN_ID, designRow(OTHER_PRIVATE_DESIGN_ID, { creator: OTHER_TEACHER_ID })],
    [OTHER_PUBLIC_DESIGN_ID, designRow(OTHER_PUBLIC_DESIGN_ID, {
        creator:    OTHER_TEACHER_ID,
        visibility: "public",
    })],
    [OTHER_ARCHIVED_PUBLIC_DESIGN_ID, designRow(OTHER_ARCHIVED_PUBLIC_DESIGN_ID, {
        creator:    OTHER_TEACHER_ID,
        visibility: "public",
        archived:   true,
    })],
]);

function designRows(designId) {
    const design = designs.get(Number(designId));
    return design ? [design] : [];
}

function rowsFor(sql, params = []) {
    // The reads each route makes before deciding, all keyed by the design id.
    if (/^\s*SELECT\b[\s\S]*\bFROM designs\b[\s\S]*WHERE (?:d\.)?id = \$1\b/u.test(sql)) {
        return designRows(params[0]);
    }
    if (/^\s*UPDATE designs\s+SET archived = \$1/u.test(sql)) {
        const design = designs.get(Number(params[1]));
        return design ? [{ id: design.id, archived: params[0] }] : [];
    }
    if (/^\s*UPDATE designs\s+SET design = \$1/u.test(sql)) {
        const design = designs.get(Number(params[2]));
        return design && !design.locked ? [{ id: design.id }] : [];
    }
    if (/^\s*INSERT INTO designs\s*\(/u.test(sql)) {
        return [{ id: COPY_ID }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => db.restore());

beforeEach(() => db.reset());

const DESIGN_NOT_FOUND = { status: 404, body: { status: "err", message: "Design not found" } };

function writes() {
    return db.queries
        .map(query => query.sql.trim())
        .filter(sql => /^(UPDATE|DELETE|INSERT)\b/u.test(sql));
}

function transactionEnds() {
    return db.queries
        .map(query => query.sql.trim())
        .filter(sql => sql === "COMMIT" || sql === "ROLLBACK");
}

const routes = {
    "PATCH /designs/:id": designId => ({
        method: "PATCH",
        path:   `/designs/${designId}`,
        body:   { design: { phases: [] }, visibility: "private" },
    }),
    "PATCH /designs/:id/toggle_public": designId => ({
        method: "PATCH",
        path:   `/designs/${designId}/toggle_public`,
        body:   {},
    }),
    "PATCH /designs/:id/lock": designId => ({
        method: "PATCH",
        path:   `/designs/${designId}/lock`,
    }),
    "PATCH /designs/:id/archive": designId => ({
        method: "PATCH",
        path:   `/designs/${designId}/archive`,
        body:   { archived: true },
    }),
    "DELETE /designs/:id": designId => ({
        method: "DELETE",
        path:   `/designs/${designId}`,
    }),
    "POST /designs/:id/duplicate": designId => ({
        method: "POST",
        path:   `/designs/${designId}/duplicate`,
    }),
};

async function send(route, designId, uid = OWNER_ID) {
    const { status, body } = await requestRouter(designsRouter, {
        ...routes[route](designId),
        session: { uid, role: "P" },
    });
    return { status, body };
}

describe("design routes answer another teacher's design as a missing one", () => {
    for (const route of Object.keys(routes)) {
        it(`${route}: another teacher's private design and a missing id get one 404`, async () => {
            const missing = await send(route, MISSING_DESIGN_ID);
            const foreign = await send(route, OTHER_PRIVATE_DESIGN_ID);

            assert.deepEqual(missing, DESIGN_NOT_FOUND);
            assert.deepEqual(foreign, DESIGN_NOT_FOUND);
            assert.deepEqual(writes(), [], "nothing is written");
            assert.ok(transactionEnds().every(sql => sql === "ROLLBACK"));
        });
    }

    const ownerOnlyRoutes = Object.keys(routes)
        .filter(name => name !== "POST /designs/:id/duplicate");
    for (const route of ownerOnlyRoutes) {
        it(`${route}: another teacher's public design gets the same 404`, async () => {
            const foreign = await send(route, OTHER_PUBLIC_DESIGN_ID);

            assert.deepEqual(foreign, DESIGN_NOT_FOUND);
            assert.deepEqual(writes(), []);
        });
    }
});

describe("the owner's design routes", () => {
    it("PATCH /designs/:id updates the owner's design", async () => {
        const { status, body } = await send("PATCH /designs/:id", OWN_DESIGN_ID);

        assert.equal(status, 200);
        assert.equal(body.status, "ok");
        assert.ok(writes().some(sql => /^UPDATE designs\s+SET design = \$1/u.test(sql)));
    });

    it("PATCH /designs/:id keeps the 409 for the owner's locked design", async () => {
        const { status, body } = await send("PATCH /designs/:id", OWN_LOCKED_DESIGN_ID);

        assert.equal(status, 409);
        assert.equal(body.code, "DESIGN_LOCKED");
    });

    it("PATCH /designs/:id/toggle_public publishes the owner's design", async () => {
        const { status, body } = await send("PATCH /designs/:id/toggle_public", OWN_DESIGN_ID);

        assert.equal(status, 200);
        assert.equal(body.result.visibility, "public");
        assert.deepEqual(transactionEnds(), ["COMMIT"]);
    });

    it("PATCH /designs/:id/lock locks the owner's design", async () => {
        const { status, body } = await send("PATCH /designs/:id/lock", OWN_DESIGN_ID);

        assert.equal(status, 200);
        assert.equal(body.status, "ok");
        assert.ok(writes().some(sql => /^UPDATE designs\s+SET locked = true/u.test(sql)));
    });

    it("PATCH /designs/:id/archive archives the owner's design", async () => {
        const { status, body } = await send("PATCH /designs/:id/archive", OWN_DESIGN_ID);

        assert.equal(status, 200);
        assert.deepEqual(body.result, { id: OWN_DESIGN_ID, archived: true });
    });

    it("DELETE /designs/:id deletes the owner's design", async () => {
        const { status, body } = await send("DELETE /designs/:id", OWN_DESIGN_ID);

        assert.equal(status, 200);
        assert.equal(body.status, "ok");
        assert.ok(writes().some(sql => /^DELETE FROM designs/u.test(sql)));
    });

    it("POST /designs/:id/duplicate copies the owner's private design", async () => {
        const { status, body } = await send("POST /designs/:id/duplicate", OWN_DESIGN_ID);

        assert.equal(status, 200);
        assert.equal(body.id, COPY_ID);
        assert.deepEqual(transactionEnds(), ["COMMIT"]);
    });
});

describe("POST /designs/:id/duplicate for another teacher's design", () => {
    it("copies a public, non-archived design", async () => {
        const { status, body } = await send("POST /designs/:id/duplicate", OTHER_PUBLIC_DESIGN_ID);

        assert.equal(status, 200);
        assert.equal(body.id, COPY_ID);
    });

    it("answers an archived public design as a missing one", async () => {
        const archived = await send("POST /designs/:id/duplicate", OTHER_ARCHIVED_PUBLIC_DESIGN_ID);

        assert.deepEqual(archived, DESIGN_NOT_FOUND);
        assert.deepEqual(writes(), []);
        assert.deepEqual(transactionEnds(), ["ROLLBACK"]);
    });
});

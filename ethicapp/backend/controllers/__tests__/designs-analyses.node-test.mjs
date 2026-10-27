// Design copies and design analyses (#848): duplicating or importing a design
// copies the source's ready analyses inside the transaction that creates the
// copy, and answers before the copy's own analyses are requested. PostgreSQL
// is a fake pg pool, so nothing here needs a database or the network.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import designsRouter from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const DESIGN_ID = 12;
const CASE_ID = 41;
const COPY_CASE_ID = 99;
const COPY_DESIGN_ID = 500;

function rowsFor(sql) {
    if (/FROM designs d\s+LEFT JOIN ethical_cases c[\s\S]*LEFT JOIN users u/u.test(sql)) {
        return [{
            id:      DESIGN_ID,
            creator: 7,
            design:  { metainfo: { title: "A design" }, phases: [] },
            case_id: CASE_ID,
        }];
    }
    if (/SELECT id, title, author_firstname[\s\S]*FROM ethical_cases\s+WHERE id = \$1/u.test(sql)) {
        return [{ id: CASE_ID, title: "A case", creator: 7, pdf_path: null }];
    }
    if (/SELECT nextval/u.test(sql)) {
        return [{ id: COPY_CASE_ID }];
    }
    if (/^\s*INSERT INTO ethical_cases\s*\(/u.test(sql)) {
        return [{ id: COPY_CASE_ID }];
    }
    if (/^\s*INSERT INTO designs\s*\(/u.test(sql)) {
        return [{ id: COPY_DESIGN_ID }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => db.restore());

beforeEach(() => {
    db.reset();
});

const normalize = sql => sql.replace(/\s+/gu, " ").trim();

describe("design copies and design analyses", () => {
    it("copies the source's ready analyses inside the transaction", async () => {
        const { status, body } = await requestRouter(designsRouter, {
            method: "POST",
            path:   `/designs/${DESIGN_ID}/duplicate`,
        });

        assert.equal(status, 200);
        assert.equal(body.id, COPY_DESIGN_ID);

        const sqls = db.queries.map(query => normalize(query.sql));
        const copyIndex = sqls.findIndex(sql => sql.startsWith(
            "INSERT INTO design_analyses (design_id, service_id, status,"
        ));
        assert.notEqual(copyIndex, -1, "the analyses are copied");
        assert.deepEqual(db.queries[copyIndex].params, [DESIGN_ID, COPY_DESIGN_ID]);
        assert.match(sqls[copyIndex], /source\.status = 'ready'/u);

        const designInsert = sqls.findIndex(sql => sql.startsWith("INSERT INTO designs ("));
        assert.ok(designInsert < copyIndex, "after the copy exists");
        assert.ok(copyIndex < sqls.indexOf("COMMIT"), "in the same transaction");
    });

    it("requests the copy's analyses in the background", async () => {
        const { status } = await requestRouter(designsRouter, {
            method: "POST",
            path:   `/designs/${DESIGN_ID}/duplicate`,
        });
        assert.equal(status, 200);

        // The copy's analyses read the copy after the answer.
        const readsCopy = () => db.queries.some(query => /FROM designs AS d/u.test(query.sql)
            && query.params?.[0] === COPY_DESIGN_ID);
        for (let attempt = 0; attempt < 20 && !readsCopy(); attempt += 1) {
            await new Promise(resolve => setImmediate(resolve));
        }
        assert.ok(readsCopy(), "the copy's analyses are requested in the background");
    });
});

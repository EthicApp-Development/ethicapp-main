// The design routes that carry a case's documents (#792, epic #789): copying a
// design copies its case with the documents, and a design's case lists them
// without availability. PostgreSQL is a fake pg pool, so nothing here needs a
// database or the network.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import designsRouter from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const DESIGN_ID = 12;
const CASE_ID = 41;
const COPY_ID = 99;
const DOC_ID = "1AbCdEfGhIjKlMn_-Doc";
const PUBLISHED_ID = "2PACX-1vAbCdEfGhIjKlMnOpQr";

const state = { documentsJson: [] };

function rowsFor(sql) {
    if (/LEFT JOIN ethical_cases c ON c\.id = d\.case_id\s+WHERE d\.id = \$1\s+AND/u.test(sql)) {
        return [{
            design_id: DESIGN_ID,
            id:        CASE_ID,
            title:     "A case",
            videos:    [],
            documents: state.documentsJson,
        }];
    }
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
        return [{ id: COPY_ID }];
    }
    if (/^\s*INSERT INTO ethical_cases\s*\(/u.test(sql)) {
        return [{ id: COPY_ID }];
    }
    if (/^\s*INSERT INTO designs\s*\(/u.test(sql)) {
        return [{ id: 500 }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);

after(() => db.restore());

beforeEach(() => {
    db.reset();
    state.documentsJson = [];
});

describe("design routes and case documents", () => {
    it("duplicating a design copies its case's documents inside the transaction", async () => {
        const { status, body } = await requestRouter(designsRouter, {
            method: "POST",
            path:   `/designs/${DESIGN_ID}/duplicate`,
        });

        assert.equal(status, 200);
        assert.equal(body.caseId, COPY_ID);
        const sqls = db.queries.map(query => query.sql.trim());
        const copyIndex = sqls.findIndex(sql => {
            return /^INSERT INTO ethical_case_documents[\s\S]*FROM ethical_case_documents ecd/u
                .test(sql);
        });
        assert.notEqual(copyIndex, -1, "the documents are copied");
        assert.deepEqual(db.queries[copyIndex].params, [CASE_ID, COPY_ID]);
        assert.ok(copyIndex < sqls.indexOf("COMMIT"));
    });

    it("GET /designs/:id/case lists the documents without availability", async () => {
        state.documentsJson = [
            {
                kind:        "published",
                product:     "document",
                id:          PUBLISHED_ID,
                resourceKey: null,
                position:    2,
            },
            { kind: "drive_file", product: "file", id: DOC_ID, resourceKey: "0-Key", position: 1 },
        ];

        const { status, body } = await requestRouter(designsRouter, {
            path:    `/designs/${DESIGN_ID}/case`,
            session: { uid: 9, role: "A" },
        });

        assert.equal(status, 200);
        assert.deepEqual(body.result.documents, [
            {
                kind:        "drive_file",
                product:     "file",
                id:          DOC_ID,
                resourceKey: "0-Key",
                position:    1,
                url:         `https://drive.google.com/file/d/${DOC_ID}/preview?resourcekey=0-Key`,
            },
            {
                kind:        "published",
                product:     "document",
                id:          PUBLISHED_ID,
                resourceKey: null,
                position:    2,
                url:         `https://docs.google.com/document/d/e/${PUBLISHED_ID}/pub`,
            },
        ]);
    });
});

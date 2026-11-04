// Design copies and their analyses (#848, #1038): duplicating or importing a
// design copies the source's ready analyses inside the transaction that
// creates the copy, and answers before the copy's own analyses are requested.
// The case copied with the design does the same with the case's analyses.
// PostgreSQL is a fake pg pool, so nothing here needs a database or the
// network.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";

import designsRouter, { designCaseCopyServices } from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const DESIGN_ID = 12;
const CASE_ID = 41;
const COPY_CASE_ID = 99;
const EXISTING_COPY_CASE_ID = 55;
const COPY_DESIGN_ID = 500;

const state = { existingCaseCopy: false };

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
    if (/SELECT id\s+FROM ethical_cases\s+WHERE creator = \$1\s+AND \(id = \$2 OR original_case_id = \$3\)/u.test(sql)) {
        return state.existingCaseCopy ? [{ id: EXISTING_COPY_CASE_ID }] : [];
    }
    if (/SELECT nextval/u.test(sql)) {
        return [{ id: COPY_CASE_ID }];
    }
    if (/^\s*INSERT INTO ethical_cases\s*\(/u.test(sql)) {
        return [{ id: COPY_CASE_ID, title: "A case", pdf_path: null, visibility: "private" }];
    }
    if (/^\s*INSERT INTO designs\s*\(/u.test(sql)) {
        return [{ id: COPY_DESIGN_ID }];
    }
    return [];
}

const db = installFakePgPool(rowsFor);
const originalRequest = designCaseCopyServices.requestCopyAnalyses;
let caseRequests = [];

after(() => db.restore());

beforeEach(() => {
    db.reset();
    state.existingCaseCopy = false;
    caseRequests = [];
    designCaseCopyServices.requestCopyAnalyses = async args => {
        caseRequests.push(args);
        return [];
    };
});

afterEach(() => {
    designCaseCopyServices.requestCopyAnalyses = originalRequest;
});

const normalize = sql => sql.replace(/\s+/gu, " ").trim();

async function settle(condition) {
    for (let attempt = 0; attempt < 20 && !condition(); attempt += 1) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

const duplicate = () => requestRouter(designsRouter, {
    method: "POST",
    path:   `/designs/${DESIGN_ID}/duplicate`,
});

// The index of the statement that copies `table`'s ready analyses, checked to
// run after `ownerInsert` and before the commit.
function assertAnalysesCopiedInTransaction(table, ownerInsert, params) {
    const sqls = db.queries.map(query => normalize(query.sql));
    const copyIndex = sqls.findIndex(sql => sql.startsWith(`INSERT INTO ${table} (`)
        && sql.includes("source.status = 'ready'"));
    assert.notEqual(copyIndex, -1, `the ${table} rows are copied`);
    assert.deepEqual(db.queries[copyIndex].params, params);

    const ownerIndex = sqls.findIndex(sql => sql.startsWith(ownerInsert));
    assert.ok(ownerIndex < copyIndex, "after the copy exists");
    assert.ok(copyIndex < sqls.indexOf("COMMIT"), "in the same transaction");
}

describe("design copies and design analyses", () => {
    it("copies the source's ready analyses inside the transaction", async () => {
        const { status, body } = await duplicate();

        assert.equal(status, 200);
        assert.equal(body.id, COPY_DESIGN_ID);
        assertAnalysesCopiedInTransaction(
            "design_analyses",
            "INSERT INTO designs (",
            [DESIGN_ID, COPY_DESIGN_ID]
        );
    });

    it("requests the copy's analyses in the background", async () => {
        const { status } = await duplicate();
        assert.equal(status, 200);

        // The copy's analyses read the copy after the answer.
        const readsCopy = () => db.queries.some(query => /FROM designs AS d/u.test(query.sql)
            && query.params?.[0] === COPY_DESIGN_ID);
        await settle(readsCopy);
        assert.ok(readsCopy(), "the copy's analyses are requested in the background");
    });
});

describe("the case copied with a design and its case analyses (#1038)", () => {
    it("copies the case's ready analyses inside the transaction", async () => {
        const { status, body } = await duplicate();

        assert.equal(status, 200);
        assert.equal(body.caseId, COPY_CASE_ID);
        assertAnalysesCopiedInTransaction(
            "case_analyses",
            "INSERT INTO ethical_cases (",
            [CASE_ID, COPY_CASE_ID]
        );
    });

    it("requests the case copy's other analyses in the background", async () => {
        const { status } = await duplicate();
        assert.equal(status, 200);

        await settle(() => caseRequests.length > 0);
        assert.equal(caseRequests.length, 1);
        const [request] = caseRequests;
        assert.equal(request.sourceCaseId, CASE_ID);
        assert.equal(request.copiedCase.id, COPY_CASE_ID);
        assert.equal(request.userId, 7);
        assert.equal(request.pdfRenderJobId, null, "a case without a PDF queues no render");
    });

    it("answers when requesting the case copy's analyses fails", async () => {
        designCaseCopyServices.requestCopyAnalyses = async () => {
            throw new Error("follow-up failed");
        };
        const originalError = console.error;
        const logged = [];
        console.error = (...args) => { logged.push(args); };

        try {
            const { status, body } = await duplicate();
            assert.equal(status, 200);
            assert.equal(body.id, COPY_DESIGN_ID);
            await settle(() => logged.some(([message]) => /analyses of a copied case/u.test(message)));
        } finally {
            console.error = originalError;
        }

        const failure = logged.find(([message]) => /analyses of a copied case/u.test(message));
        assert.equal(failure?.[1].error.message, "follow-up failed");
    });

    it("reuses the teacher's existing copy of the case without copying or requesting", async () => {
        state.existingCaseCopy = true;

        const { status, body } = await duplicate();

        assert.equal(status, 200);
        assert.equal(body.caseId, EXISTING_COPY_CASE_ID);
        assert.ok(!db.queries.some(query => /INSERT INTO case_analyses/u.test(query.sql)));
        await settle(() => caseRequests.length > 0);
        assert.equal(caseRequests.length, 0);
    });
});

// The related rows of a copied case (#1089). Importing a case from Casos
// (POST /cases/:id/import), duplicating one's own case
// (POST /cases/:id/duplicate) and importing a design, which copies its case
// (POST /designs/:id/duplicate), copy the source's authors, tags, videos and
// documents with one function, copyCaseRelatedRows, so the three paths send
// the same statements inside the transaction that creates the copy.
//
// The source has no PDF, so no file is copied. PostgreSQL is a fake pg pool
// and the background requests are fakes, so nothing here needs a database or
// the network.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";

import casesRouter, { caseCopyServices } from "../cases.js";
import designsRouter, { designCaseCopyServices } from "../designs.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";

const AUTHOR_ID = 7;
const IMPORTER_ID = 8;
const DESIGN_ID = 12;
const CASE_ID = 41;
const COPY_CASE_ID = 99;

function rowsFor(sql) {
    if (/FROM designs d\s+LEFT JOIN ethical_cases c[\s\S]*LEFT JOIN users u/u.test(sql)) {
        return [{
            id:         DESIGN_ID,
            creator:    AUTHOR_ID,
            visibility: "public",
            archived:   false,
            design:     { metainfo: { title: "A design" }, phases: [] },
            case_id:    CASE_ID,
        }];
    }
    if (/SELECT id, title, author_firstname[\s\S]*FROM ethical_cases\s+WHERE id = \$1/u.test(sql)) {
        return [{
            id:            CASE_ID,
            title:         "A case",
            pdf_path:      null,
            creator:       AUTHOR_ID,
            visibility:    "public",
            archived:      false,
            license_code:  "CC-BY-4.0",
            language_code: "en_US",
        }];
    }
    if (/SELECT nextval/u.test(sql)) {
        return [{ id: COPY_CASE_ID }];
    }
    if (/^\s*INSERT INTO ethical_cases\s*\(/u.test(sql)) {
        return [{ id: COPY_CASE_ID, title: "A case", pdf_path: null, visibility: "private" }];
    }
    if (/^\s*INSERT INTO designs\s*\(/u.test(sql)) {
        return [{ id: 500 }];
    }
    if (/FROM ethical_cases c[\s\S]*WHERE c\.id = \$1/u.test(sql)) {
        return [{
            id:         COPY_CASE_ID,
            title:      "A case (copy)",
            pdf_path:   null,
            visibility: "private",
        }];
    }
    return [];
}

const RELATED_TABLES = [
    "ethical_cases_authors",
    "ethical_cases_tags",
    "ethical_case_videos",
    "ethical_case_documents",
];

const db = installFakePgPool(rowsFor);
const originals = {
    caseRender:     caseCopyServices.ensureRenderJob,
    caseAnalyses:   caseCopyServices.requestCopyAnalyses,
    designRender:   designCaseCopyServices.ensureRenderJob,
    designAnalyses: designCaseCopyServices.requestCopyAnalyses,
};

after(() => db.restore());

beforeEach(() => {
    db.reset();
    caseCopyServices.ensureRenderJob = async () => null;
    caseCopyServices.requestCopyAnalyses = async () => [];
    designCaseCopyServices.ensureRenderJob = async () => null;
    designCaseCopyServices.requestCopyAnalyses = async () => [];
});

afterEach(() => {
    caseCopyServices.ensureRenderJob = originals.caseRender;
    caseCopyServices.requestCopyAnalyses = originals.caseAnalyses;
    designCaseCopyServices.ensureRenderJob = originals.designRender;
    designCaseCopyServices.requestCopyAnalyses = originals.designAnalyses;
});

const normalize = sql => sql.replace(/\s+/gu, " ").trim();

// The related-row statements a request sent, and where they fall between the
// transaction's BEGIN and COMMIT.
async function relatedRowStatements(request) {
    db.reset();
    const { status } = await request();
    const statements = db.queries.map(({ sql, params }) => ({ sql: normalize(sql), params }));
    const begin = statements.findIndex(({ sql }) => sql === "BEGIN");
    const commit = statements.findIndex(({ sql }) => sql === "COMMIT");
    const related = statements
        .map((statement, index) => ({ ...statement, index }))
        .filter(({ sql }) => RELATED_TABLES.some(table => sql.startsWith(`INSERT INTO ${table}`)));
    return { status, begin, commit, related };
}

const paths = {
    "a case import": () => requestRouter(casesRouter, {
        method:  "POST",
        path:    `/cases/${CASE_ID}/import`,
        session: { uid: IMPORTER_ID, role: "P" },
    }),
    "a case duplicate": () => requestRouter(casesRouter, {
        method:  "POST",
        path:    `/cases/${CASE_ID}/duplicate`,
        session: { uid: IMPORTER_ID, role: "P" },
    }),
    "a design import": () => requestRouter(designsRouter, {
        method:  "POST",
        path:    `/designs/${DESIGN_ID}/duplicate`,
        session: { uid: IMPORTER_ID, role: "P" },
    }),
};

describe("the related rows of a copied case (#1089)", () => {
    for (const [name, request] of Object.entries(paths)) {
        it(`${name} copies the related rows in its transaction`, async () => {
            const { status, begin, commit, related } = await relatedRowStatements(request);

            assert.ok(status === 200 || status === 201, `answered ${status}`);
            const tableOf = sql => RELATED_TABLES
                .find(table => sql.startsWith(`INSERT INTO ${table}`));
            assert.deepEqual(related.map(({ sql }) => tableOf(sql)), RELATED_TABLES);
            assert.ok(related.every(({ index }) => index > begin && index < commit));
            assert.deepEqual(related.map(({ params }) => params), [
                [COPY_CASE_ID, CASE_ID],
                [COPY_CASE_ID, CASE_ID, IMPORTER_ID],
                [CASE_ID, COPY_CASE_ID],
                [CASE_ID, COPY_CASE_ID],
            ]);
        });
    }

    it("sends the same statements on the three paths", async () => {
        // The fake pool's log is shared, so the paths run one after another.
        const sent = [];
        for (const request of Object.values(paths)) {
            const { related } = await relatedRowStatements(request);
            sent.push(related.map(({ sql, params }) => ({ sql, params })));
        }

        assert.deepEqual(sent[1], sent[0], "a case duplicate sends what a case import sends");
        assert.deepEqual(sent[2], sent[0], "a design import sends what a case import sends");
    });
});

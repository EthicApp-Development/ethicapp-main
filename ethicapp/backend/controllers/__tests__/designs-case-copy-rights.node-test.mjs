// The license and rights of the case copied with a design (#1085): importing
// another teacher's public design (POST /designs/:id/duplicate) copies its
// case with the case's license and rights details, as importing the case from
// Casos (POST /cases/:id/import) does, and a teacher's existing copy of the
// case is still reused. PostgreSQL is a fake pg pool and the background
// requests are fakes, so nothing here needs a database or the network.
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";

import casesRouter, { caseCopyServices } from "../cases.js";
import designsRouter, { designCaseCopyServices } from "../designs.js";
import { CASE_DEFAULT_LICENSE } from "../../helpers/sharing-policy-helper.js";
import { installFakePgPool, requestRouter } from "./fake-pg-pool.mjs";
import { insertedRow } from "./inserted-row.mjs";

const AUTHOR_ID = 7;
const IMPORTER_ID = 8;
const DESIGN_ID = 12;
const CASE_ID = 41;
const COPY_CASE_ID = 99;
const EXISTING_COPY_CASE_ID = 55;
const COPY_DESIGN_ID = 500;

const RIGHTS = Object.freeze({
    rights_status:        "used_with_permission",
    license_notes:        "Notes on the license",
    permission_statement: "Used with the publisher's permission",
    commercial_source:    "A publisher",
});

const state = { sourceCase: null, existingCaseCopy: false };

function sourceCaseRow(overrides = {}) {
    return {
        id:               CASE_ID,
        title:            "A case",
        author_firstname: "Ada",
        author_lastname:  "Lovelace",
        author_email:     "ada@example.org",
        pdf_path:         null,
        creator:          AUTHOR_ID,
        visibility:       "public",
        archived:         false,
        license_code:     "CC-BY-4.0",
        attribution_text: null,
        original_case_id: null,
        language_code:    "en_US",
        ...RIGHTS,
        ...overrides,
    };
}

// copyCaseForUser's look-up of the teacher's existing copy of the case.
const EXISTING_COPY_SQL = new RegExp(
    String.raw`SELECT id\s+FROM ethical_cases\s+WHERE creator = \$1\s+`
    + String.raw`AND \(id = \$2 OR original_case_id = \$3\)`,
    "u"
);

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
        return [state.sourceCase];
    }
    if (EXISTING_COPY_SQL.test(sql)) {
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
    // The case import's answer reads the copy back.
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

const db = installFakePgPool(rowsFor);
const originalDesignRequest = designCaseCopyServices.requestCopyAnalyses;
const originalCaseRequest = caseCopyServices.requestCopyAnalyses;

after(() => db.restore());

beforeEach(() => {
    db.reset();
    state.sourceCase = sourceCaseRow();
    state.existingCaseCopy = false;
    designCaseCopyServices.requestCopyAnalyses = async () => [];
    caseCopyServices.requestCopyAnalyses = async () => [];
});

afterEach(() => {
    designCaseCopyServices.requestCopyAnalyses = originalDesignRequest;
    caseCopyServices.requestCopyAnalyses = originalCaseRequest;
});

const session = { uid: IMPORTER_ID, role: "P" };

const importDesign = () => requestRouter(designsRouter, {
    method: "POST",
    path:   `/designs/${DESIGN_ID}/duplicate`,
    session,
});

const importCase = () => requestRouter(casesRouter, {
    method: "POST",
    path:   `/cases/${CASE_ID}/import`,
    session,
});

function caseCopyInserts() {
    return db.queries
        .filter(query => /^\s*INSERT INTO ethical_cases\s*\(/u.test(query.sql))
        .map(query => insertedRow(query.sql, query.params));
}

describe("the case copied by a design import (#1085)", () => {
    it("keeps the case's license and rights details", async () => {
        const { status, body } = await importDesign();

        assert.equal(status, 200);
        assert.equal(body.caseId, COPY_CASE_ID);
        const [copy] = caseCopyInserts();
        assert.equal(copy.license_code, "CC-BY-4.0");
        assert.equal(copy.rights_status, RIGHTS.rights_status);
        assert.equal(copy.license_notes, RIGHTS.license_notes);
        assert.equal(copy.permission_statement, RIGHTS.permission_statement);
        assert.equal(copy.commercial_source, RIGHTS.commercial_source);
    });

    it("keeps the source's license code and the attribution as before", async () => {
        await importDesign();

        const [copy] = caseCopyInserts();
        assert.equal(copy.source_case_license_code, "CC-BY-4.0");
        assert.equal(copy.attribution_text, "\"A case\", by Ada Lovelace, licensed CC-BY-4.0");
        assert.equal(copy.title, "A case", "the design import keeps the case's title");
        assert.equal(copy.creator, IMPORTER_ID);
        assert.equal(copy.visibility, "private");
        assert.equal(copy.imported_from_case_id, CASE_ID);
    });

    it("gives a case without a license the default license", async () => {
        state.sourceCase = sourceCaseRow({ license_code: null });

        const { status } = await importDesign();

        assert.equal(status, 200);
        const [copy] = caseCopyInserts();
        assert.equal(copy.license_code, CASE_DEFAULT_LICENSE);
        assert.equal(copy.source_case_license_code, CASE_DEFAULT_LICENSE);
    });

    it("gives the copy the license and rights an import from Casos gives it", async () => {
        await importDesign();
        const [designImportCopy] = caseCopyInserts();
        db.reset();
        const { status } = await importCase();
        assert.equal(status, 201);
        const [caseImportCopy] = caseCopyInserts();

        // Only the title follows each route's rule.
        const { title: designImportTitle, ...designImportRest } = designImportCopy;
        const { title: caseImportTitle, ...caseImportRest } = caseImportCopy;
        assert.equal(designImportTitle, "A case");
        assert.notEqual(caseImportTitle, designImportTitle);
        assert.deepEqual(designImportRest, caseImportRest);
    });

    it("still reuses the teacher's existing copy of the case", async () => {
        state.existingCaseCopy = true;

        const { status, body } = await importDesign();

        assert.equal(status, 200);
        assert.equal(body.caseId, EXISTING_COPY_CASE_ID);
        assert.deepEqual(caseCopyInserts(), []);
        const designInsert = db.queries
            .find(query => /^\s*INSERT INTO designs\s*\(/u.test(query.sql));
        assert.equal(designInsert.params[2], EXISTING_COPY_CASE_ID, "the design uses that copy");
    });
});

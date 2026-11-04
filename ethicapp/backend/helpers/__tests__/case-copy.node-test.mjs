// The row of a copy of a case (#1085), shared by the case import, the case
// duplicate and the design import: the copy keeps the source's license and
// rights details, and falls back to the default license when the source has
// none.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { insertedRow } from "../../controllers/__tests__/inserted-row.mjs";
import { buildCaseCopyInsert, CASE_COPY_SOURCE_COLUMNS_SQL } from "../case-copy.js";
import { CASE_DEFAULT_LICENSE } from "../sharing-policy-helper.js";

const SOURCE_CASE = Object.freeze({
    id:                   41,
    title:                "A case",
    author_firstname:     "Ada",
    author_lastname:      "Lovelace",
    author_email:         "ada@example.org",
    pdf_path:             "/uploads/cases/41/case.pdf",
    creator:              7,
    visibility:           "public",
    license_code:         "CC-BY-4.0",
    attribution_text:     null,
    original_case_id:     null,
    rights_status:        "used_with_permission",
    license_notes:        "Notes on the license",
    permission_statement: "Used with the publisher's permission",
    commercial_source:    "A publisher",
    language_code:        "en_US",
});

function copyRow(sourceCase, overrides = {}) {
    const { sql, params } = buildCaseCopyInsert({
        caseId:     99,
        sourceCase,
        title:      "A case (copy)",
        pdfPath:    "/uploads/cases/99/case.pdf",
        creator:    8,
        visibility: "private",
        ...overrides,
    });
    return insertedRow(sql, params);
}

describe("buildCaseCopyInsert", () => {
    it("keeps the source's license and rights details", () => {
        const row = copyRow(SOURCE_CASE);

        assert.equal(row.license_code, "CC-BY-4.0");
        assert.equal(row.source_case_license_code, "CC-BY-4.0");
        assert.equal(row.rights_status, "used_with_permission");
        assert.equal(row.license_notes, "Notes on the license");
        assert.equal(row.permission_statement, "Used with the publisher's permission");
        assert.equal(row.commercial_source, "A publisher");
    });

    it("gives a source without a license the default license", () => {
        const row = copyRow({ ...SOURCE_CASE, license_code: null });

        assert.equal(row.license_code, CASE_DEFAULT_LICENSE);
        assert.equal(row.source_case_license_code, CASE_DEFAULT_LICENSE);
        assert.equal(
            row.attribution_text,
            `"A case", by Ada Lovelace, licensed ${CASE_DEFAULT_LICENSE}`
        );
    });

    it("stores no rights details a source does not have", () => {
        const rightsColumns = [
            "rights_status", "license_notes", "permission_statement", "commercial_source",
        ];
        const withoutRights = Object.fromEntries(Object.entries(SOURCE_CASE)
            .filter(([column]) => !rightsColumns.includes(column)));
        const row = copyRow(withoutRights);

        assert.equal(row.rights_status, null);
        assert.equal(row.license_notes, null);
        assert.equal(row.permission_statement, null);
        assert.equal(row.commercial_source, null);
    });

    it("keeps the source's attribution, or builds one from its title, author and license", () => {
        assert.equal(
            copyRow(SOURCE_CASE).attribution_text,
            "\"A case\", by Ada Lovelace, licensed CC-BY-4.0"
        );
        assert.equal(
            copyRow({ ...SOURCE_CASE, attribution_text: "Kept attribution" }).attribution_text,
            "Kept attribution"
        );
    });

    it("records the copy's provenance, owner and the values each route chooses", () => {
        const row = copyRow({ ...SOURCE_CASE, original_case_id: 30 });

        assert.deepEqual(row, {
            id:                       99,
            title:                    "A case (copy)",
            author_firstname:         "Ada",
            author_lastname:          "Lovelace",
            author_email:             "ada@example.org",
            pdf_path:                 "/uploads/cases/99/case.pdf",
            creator:                  8,
            visibility:               "private",
            license_code:             "CC-BY-4.0",
            attribution_text:         "\"A case\", by Ada Lovelace, licensed CC-BY-4.0",
            original_case_id:         30,
            imported_from_case_id:    41,
            source_case_title:        "A case",
            source_case_author:       "Ada Lovelace",
            source_case_license_code: "CC-BY-4.0",
            is_editable_copy:         true,
            rights_status:            "used_with_permission",
            license_notes:            "Notes on the license",
            permission_statement:     "Used with the publisher's permission",
            commercial_source:        "A publisher",
            language_code:            "en_US",
            archived:                 false,
        });
        assert.equal(copyRow(SOURCE_CASE).original_case_id, 41, "an original is its own root");
    });

    it("normalizes the visibility and the language", () => {
        const row = copyRow({ ...SOURCE_CASE, language_code: "" }, { visibility: "shared" });

        assert.equal(row.visibility, "private");
        assert.equal(row.language_code, "es_CL");
    });

    it("reads only source columns that CASE_COPY_SOURCE_COLUMNS_SQL selects", () => {
        const selected = CASE_COPY_SOURCE_COLUMNS_SQL.split(",").map(column => column.trim());
        const read = new Set();
        const recordingSource = new Proxy(SOURCE_CASE, {
            get(target, property) {
                read.add(property);
                return target[property];
            },
        });

        copyRow(recordingSource);

        assert.deepEqual([...read].filter(column => !selected.includes(column)), []);
        // The routes read the rest: the PDF to copy, and the creator and
        // visibility for their access rules.
        const unread = selected.filter(column => !read.has(column));
        assert.deepEqual(unread, ["pdf_path", "creator", "visibility"]);
    });
});

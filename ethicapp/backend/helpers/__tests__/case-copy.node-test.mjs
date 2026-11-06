// The copy of a case, shared by the case import, the case duplicate and the
// design import: the copy's row keeps the source's license and rights details
// and falls back to the default license when the source has none (#1085); the
// PDF file is copied under the uploads root; and the authors, tags, videos and
// documents are copied by one function (#1089). The file tests use a
// temporary uploads root, and the related rows a recording client.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { insertedRow } from "../../controllers/__tests__/inserted-row.mjs";
import {
    buildCaseCopyInsert,
    CASE_COPY_SOURCE_COLUMNS_SQL,
    copyCasePdfIfPresent,
    copyCaseRelatedRows,
    uploadPublicPathToAbsolute,
} from "../case-copy.js";
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

describe("uploadPublicPathToAbsolute (#1089)", () => {
    const root = path.resolve("/srv/uploads");

    it("maps /uploads and assets/uploads paths under the uploads root", () => {
        assert.equal(
            uploadPublicPathToAbsolute("/uploads/cases/41/case.pdf", root),
            path.join(root, "cases/41/case.pdf")
        );
        assert.equal(
            uploadPublicPathToAbsolute("assets/uploads/cases/41/case.pdf", root),
            path.join(root, "cases/41/case.pdf")
        );
        assert.equal(
            uploadPublicPathToAbsolute("\\uploads\\cases\\41\\case.pdf", root),
            path.join(root, "cases/41/case.pdf"),
            "backslashes are read as slashes"
        );
    });

    it("refuses an empty path and one that climbs out of the root", () => {
        assert.equal(uploadPublicPathToAbsolute(null, root), null);
        assert.equal(uploadPublicPathToAbsolute("/uploads/", root), null);
        assert.equal(uploadPublicPathToAbsolute("/uploads/../secrets.txt", root), null);
        assert.equal(uploadPublicPathToAbsolute("/uploads/cases/../../secrets.txt", root), null);
    });
});

describe("copyCasePdfIfPresent (#1089)", () => {
    let root;

    before(async () => {
        root = await mkdtemp(path.join(tmpdir(), "case-copy-pdf-"));
        await mkdir(path.join(root, "cases", "41"), { recursive: true });
        await writeFile(path.join(root, "cases", "41", "case.pdf"), "%PDF-1.4 source");
    });

    after(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("copies the file into the copy's directory, which it creates", async () => {
        const copied = await copyCasePdfIfPresent(
            "/uploads/cases/41/case.pdf",
            "/uploads/cases/99/case.pdf",
            root
        );

        assert.equal(copied, true);
        const copy = await readFile(path.join(root, "cases", "99", "case.pdf"), "utf8");
        assert.equal(copy, "%PDF-1.4 source");
    });

    it("answers false without a PDF, for a missing file or a path out of the root", async () => {
        assert.equal(await copyCasePdfIfPresent(null, "/uploads/cases/98/case.pdf", root), false);
        assert.equal(
            await copyCasePdfIfPresent(
                "/uploads/cases/41/missing.pdf",
                "/uploads/cases/97/case.pdf",
                root
            ),
            false
        );
        assert.equal(
            await copyCasePdfIfPresent("/uploads/../outside.pdf", "/uploads/cases/96/x.pdf", root),
            false
        );
    });
});

describe("copyCaseRelatedRows (#1089)", () => {
    const normalize = sql => sql.replace(/\s+/gu, " ").trim();

    async function recordedStatements() {
        const statements = [];
        const client = {
            query: async (sql, params) => {
                statements.push({ sql: normalize(sql), params });
                return { rows: [] };
            },
        };
        await copyCaseRelatedRows(client, { sourceCaseId: 41, targetCaseId: 99, assignedBy: 8 });
        return statements;
    }

    it("copies the authors, tags, videos and documents, in order, on the client", async () => {
        const statements = await recordedStatements();

        assert.deepEqual(
            statements.map(({ sql }) => /^INSERT INTO (\w+)/u.exec(sql)?.[1]),
            [
                "ethical_cases_authors",
                "ethical_cases_tags",
                "ethical_case_videos",
                "ethical_case_documents",
            ]
        );
    });

    it("gives each statement the copy, the source and the copying teacher", async () => {
        const [authors, tags, videos, documents] = await recordedStatements();

        assert.deepEqual(authors.params, [99, 41]);
        assert.match(authors.sql, /SELECT \$1, ca\.author_id, u\.id, .* WHERE ca\.case_id = \$2/u);
        assert.match(
            authors.sql,
            /LEFT JOIN users u ON LOWER\(u\.mail\) = LOWER\(a\.author_email\)/u
        );
        assert.deepEqual(tags.params, [99, 41, 8]);
        assert.match(
            tags.sql,
            /SELECT \$1, ect\.tag_id, \$3 FROM ethical_cases_tags ect WHERE ect\.case_id = \$2/u
        );
        assert.deepEqual(videos.params, [41, 99]);
        assert.deepEqual(documents.params, [41, 99]);
    });
});

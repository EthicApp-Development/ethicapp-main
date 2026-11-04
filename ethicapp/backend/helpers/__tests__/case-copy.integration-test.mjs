// Integration tests for the row of a copy of a case (#1085), against a real
// PostgreSQL database with migrations applied: the statement that the case
// import, the case duplicate and the design import share is run against the
// real `ethical_cases` columns, defaults, checks and license foreign key.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { buildCaseCopyInsert, CASE_COPY_SOURCE_COLUMNS_SQL } from "../case-copy.js";
import { CASE_DEFAULT_LICENSE } from "../sharing-policy-helper.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
    return pool;
}

const query = async (sql, params = []) => (await getPool().query(sql, params)).rows;

test.after(async () => {
    await pool?.end();
});

async function createTeacher() {
    const [user] = await query(`
        INSERT INTO users (name, mail, role)
        VALUES ('Integration teacher', $1, 'P')
        RETURNING id;
    `, [`${randomUUID()}@integration.test`]);
    return user.id;
}

async function createCase(creator, { licenseCode, rights = {} }) {
    const [row] = await query(`
        INSERT INTO ethical_cases
            (title, author_firstname, author_lastname, author_email, pdf_path, creator,
             visibility, license_code, rights_status, license_notes, permission_statement,
             commercial_source, language_code)
        VALUES ('Integration case', 'Ada', 'Lovelace', 'ada@integration.test',
                '/uploads/cases/0/case.pdf', $1, 'public', $2, $3, $4, $5, $6, 'en_US')
        RETURNING id;
    `, [
        creator,
        licenseCode,
        rights.rightsStatus ?? "own_work",
        rights.licenseNotes ?? null,
        rights.permissionStatement ?? null,
        rights.commercialSource ?? null,
    ]);
    return row.id;
}

// Copies the case as the routes do: read the source, take an id, insert.
async function copyCase(sourceCaseId, creator) {
    const [sourceCase] = await query(`
        SELECT ${CASE_COPY_SOURCE_COLUMNS_SQL}
        FROM ethical_cases
        WHERE id = $1;
    `, [sourceCaseId]);
    const [{ id }] = await query(
        "SELECT nextval(pg_get_serial_sequence('ethical_cases', 'id')) AS id;"
    );
    const { sql, params } = buildCaseCopyInsert({
        caseId:     Number(id),
        sourceCase,
        title:      "Integration case (copy)",
        pdfPath:    sourceCase.pdf_path,
        creator,
        visibility: "private",
    });
    const [inserted] = await query(sql, params);
    const [copy] = await query(`
        SELECT title, creator, visibility, license_code, attribution_text, original_case_id,
               imported_from_case_id, source_case_title, source_case_author,
               source_case_license_code, is_editable_copy, rights_status, license_notes,
               permission_statement, commercial_source, language_code, archived
        FROM ethical_cases
        WHERE id = $1;
    `, [inserted.id]);
    return copy;
}

test("case copy: keeps the source's license and rights details", {
    skip: SKIP_REASON,
}, async () => {
    const author = await createTeacher();
    const importer = await createTeacher();
    const sourceCaseId = await createCase(author, {
        licenseCode: "CC-BY-4.0",
        rights:      {
            rightsStatus:        "used_with_permission",
            licenseNotes:        "Notes on the license",
            permissionStatement: "Used with the publisher's permission",
            commercialSource:    "A publisher",
        },
    });

    const copy = await copyCase(sourceCaseId, importer);

    assert.deepEqual(copy, {
        title:                    "Integration case (copy)",
        creator:                  importer,
        visibility:               "private",
        license_code:             "CC-BY-4.0",
        attribution_text:         "\"Integration case\", by Ada Lovelace, licensed CC-BY-4.0",
        original_case_id:         sourceCaseId,
        imported_from_case_id:    sourceCaseId,
        source_case_title:        "Integration case",
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
});

test("case copy: a source without a license gets the default license", {
    skip: SKIP_REASON,
}, async () => {
    const author = await createTeacher();
    const importer = await createTeacher();
    const sourceCaseId = await createCase(author, { licenseCode: null });

    const copy = await copyCase(sourceCaseId, importer);

    assert.equal(copy.license_code, CASE_DEFAULT_LICENSE);
    assert.equal(copy.source_case_license_code, CASE_DEFAULT_LICENSE);
    assert.equal(copy.rights_status, "own_work");
});

// Integration tests for the copy of a case, against a real PostgreSQL database
// with migrations applied. The case import, the case duplicate and the design
// import share the statement that inserts the copy's row (#1085), run against
// the real `ethical_cases` columns, defaults, checks and license foreign key,
// and the function that copies its authors, tags, videos and documents
// (#1089), run against the real tables, keys and checks.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import {
    buildCaseCopyInsert,
    CASE_COPY_SOURCE_COLUMNS_SQL,
    copyCaseRelatedRows,
} from "../case-copy.js";
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

// A case tag, in a taxonomy and category of its own.
async function createCaseTag() {
    const code = `it-${randomUUID()}`;
    await query(`
        INSERT INTO tag_taxonomies (code, version) VALUES ($1, '1');
    `, [code]);
    const [category] = await query(`
        INSERT INTO tag_categories (taxonomy_code, code, usable_for_cases, usable_for_designs)
        VALUES ($1, 'category', true, true)
        RETURNING id;
    `, [code]);
    const [tag] = await query(`
        INSERT INTO tags (category_id, code, usable_for_cases, usable_for_designs)
        VALUES ($1, $2, true, true)
        RETURNING id;
    `, [category.id, code]);
    return tag.id;
}

async function createAuthor(email) {
    const [author] = await query(`
        INSERT INTO ethical_case_author (author_firstname, author_lastname, author_email)
        VALUES ('Grace', 'Hopper', $1)
        RETURNING id;
    `, [email]);
    return author.id;
}

// The rows copyCaseRelatedRows copies, as the copy holds them.
async function relatedRows(caseId) {
    return {
        authors: await query(`
            SELECT author_id, user_id, author_order, is_primary
            FROM ethical_cases_authors
            WHERE case_id = $1
            ORDER BY author_order;
        `, [caseId]),
        tags: await query(`
            SELECT tag_id, assigned_by
            FROM ethical_cases_tags
            WHERE case_id = $1
            ORDER BY tag_id;
        `, [caseId]),
        videos: await query(`
            SELECT position, youtube_video_id
            FROM ethical_case_videos
            WHERE case_id = $1
            ORDER BY position;
        `, [caseId]),
        documents: await query(`
            SELECT position, kind, product, external_id, resource_key
            FROM ethical_case_documents
            WHERE case_id = $1
            ORDER BY position;
        `, [caseId]),
    };
}

test("case copy: copies the authors, tags, videos and documents in the caller's transaction", {
    skip: SKIP_REASON,
}, async () => {
    const author = await createTeacher();
    const importer = await createTeacher();
    const [{ mail: authorMail }] = await query("SELECT mail FROM users WHERE id = $1;", [author]);
    const sourceCaseId = await createCase(author, { licenseCode: "CC-BY-4.0" });
    // The copy's row, without related rows of its own.
    const copyCaseId = await createCase(importer, { licenseCode: "CC-BY-4.0" });

    // An author with an account, whose email differs only in letter case, and
    // one without.
    const accountAuthor = await createAuthor(authorMail.toUpperCase());
    const otherAuthor = await createAuthor(`${randomUUID()}@integration.test`);
    await query(`
        INSERT INTO ethical_cases_authors (case_id, author_id, user_id, author_order, is_primary)
        VALUES ($1, $2, NULL, 1, true), ($1, $3, NULL, 2, false);
    `, [sourceCaseId, accountAuthor, otherAuthor]);
    const firstTag = await createCaseTag();
    const secondTag = await createCaseTag();
    await query(`
        INSERT INTO ethical_cases_tags (case_id, tag_id, assigned_by)
        VALUES ($1, $2, $3), ($1, $4, $3);
    `, [sourceCaseId, firstTag, author, secondTag]);
    await query(`
        INSERT INTO ethical_case_videos (case_id, position, youtube_video_id)
        VALUES ($1, 1, 'dQw4w9WgXcQ'), ($1, 2, 'M7lc1UVf-VE');
    `, [sourceCaseId]);
    await query(`
        INSERT INTO ethical_case_documents
            (case_id, position, kind, product, external_id, resource_key)
        VALUES ($1, 1, 'drive_file', 'file', '1AbCdEfGhIjKlMnOpQrStUvWx', 'key_1'),
               ($1, 2, 'published', 'document', '2PACX-1AbCdEfGhIjKlMnOpQrStUvWx', NULL);
    `, [sourceCaseId]);

    const client = await getPool().connect();
    try {
        await client.query("BEGIN");
        await copyCaseRelatedRows(client, {
            sourceCaseId,
            targetCaseId: copyCaseId,
            assignedBy:   importer,
        });
        // Nothing is visible outside the transaction until it commits.
        assert.deepEqual((await relatedRows(copyCaseId)).authors, []);
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }

    const source = await relatedRows(sourceCaseId);
    const copy = await relatedRows(copyCaseId);
    assert.deepEqual(copy.authors, [
        { author_id: accountAuthor, user_id: author, author_order: 1, is_primary: true },
        { author_id: otherAuthor, user_id: null, author_order: 2, is_primary: false },
    ]);
    assert.deepEqual(copy.tags, [
        { tag_id: firstTag, assigned_by: importer },
        { tag_id: secondTag, assigned_by: importer },
    ]);
    assert.deepEqual(copy.videos, source.videos);
    assert.deepEqual(copy.documents, source.documents);
    assert.equal(copy.videos.length, 2);
    assert.equal(copy.documents.length, 2);
});

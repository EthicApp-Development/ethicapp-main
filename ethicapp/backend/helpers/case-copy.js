// The row of a copy of a case (#1085). Importing a case from Casos
// (POST /cases/:id/import), duplicating one's own case
// (POST /cases/:id/duplicate) and importing or duplicating a design, which
// copies its case (`copyCaseForUser` in controllers/designs.js), all read the
// source with CASE_COPY_SOURCE_COLUMNS_SQL and insert the copy with
// buildCaseCopyInsert. A copy therefore carries the same columns from its
// source whichever way it is made: the author names, the PDF, the license and
// the rights details, the attribution, the language and the provenance.
//
// Each route keeps its own rules: which sources it may copy, whether an
// existing copy is reused, the copy's title and its visibility.

import {
    CASE_DEFAULT_LICENSE,
    buildAttributionText,
    getCaseAuthorName,
    normalizeLanguageCode,
    normalizeVisibility,
} from "./sharing-policy-helper.js";

// The source columns buildCaseCopyInsert reads, for the routes' SELECT.
export const CASE_COPY_SOURCE_COLUMNS_SQL = `
    id, title, author_firstname, author_lastname, author_email, pdf_path, creator,
    visibility, license_code, attribution_text, original_case_id,
    rights_status, license_notes, permission_statement, commercial_source,
    language_code
`.trim();

/**
 * The statement that inserts a copy of `sourceCase`, an editable copy that is
 * not archived. It keeps the source's license (CASE_DEFAULT_LICENSE when the
 * source has none) and its rights status, license notes, permission statement
 * and commercial source. The attribution is the source's, or else one built
 * from the source's title, author and license.
 *
 * @param {object} options
 * @param {number} options.caseId - The copy's id, from the table's sequence.
 * @param {object} options.sourceCase - The source row, with
 *     CASE_COPY_SOURCE_COLUMNS_SQL.
 * @param {string} options.title - The copy's title.
 * @param {string|null} options.pdfPath - The copy's PDF path.
 * @param {number|string} options.creator - The copying teacher.
 * @param {string} options.visibility - The copy's visibility.
 * @returns {{sql: string, params: Array}} For `client.query(sql, params)`; it
 *     returns the copy's id, case_uuid, title, pdf_path, language_code and
 *     visibility.
 */
export function buildCaseCopyInsert({ caseId, sourceCase, title, pdfPath, creator, visibility }) {
    const sourceAuthor = getCaseAuthorName(sourceCase);
    const sourceLicenseCode = sourceCase.license_code || CASE_DEFAULT_LICENSE;

    return {
        sql: `
            INSERT INTO ethical_cases
                (id, title, author_firstname, author_lastname, author_email, pdf_path, creator,
                 visibility, license_code, attribution_text, original_case_id,
                 imported_from_case_id, source_case_title, source_case_author,
                 source_case_license_code, is_editable_copy,
                 rights_status, license_notes, permission_statement, commercial_source,
                 language_code, archived)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7,
                 $8, $9, COALESCE($10, $11), $12, $13,
                 $14, $15, $16, true,
                 $17, $18, $19, $20, $21,
                 false)
            RETURNING id, case_uuid, title, pdf_path, language_code, visibility;
        `,
        params: [
            caseId,
            title,
            sourceCase.author_firstname,
            sourceCase.author_lastname,
            sourceCase.author_email,
            pdfPath,
            creator,
            normalizeVisibility(visibility),
            sourceLicenseCode,
            sourceCase.attribution_text,
            buildAttributionText({
                title:       sourceCase.title,
                author:      sourceAuthor,
                licenseCode: sourceLicenseCode,
            }),
            sourceCase.original_case_id || sourceCase.id,
            sourceCase.id,
            sourceCase.title,
            sourceAuthor,
            sourceLicenseCode,
            sourceCase.rights_status ?? null,
            sourceCase.license_notes ?? null,
            sourceCase.permission_statement ?? null,
            sourceCase.commercial_source ?? null,
            normalizeLanguageCode(sourceCase.language_code),
        ],
    };
}

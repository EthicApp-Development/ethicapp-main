// A copy of a case (#1085, #1089). Importing a case from Casos
// (POST /cases/:id/import), duplicating one's own case
// (POST /cases/:id/duplicate) and importing or duplicating a design, which
// copies its case (`copyCaseForUser` in controllers/designs.js), all copy a
// case with the helpers of this module:
//
// - copyCasePdfIfPresent copies the source's PDF file into the copy's upload
//   directory;
// - buildCaseCopyInsert inserts the copy's row, read from the source with
//   CASE_COPY_SOURCE_COLUMNS_SQL;
// - copyCaseRelatedRows copies the source's authors, tags, videos and
//   documents.
//
// A copy therefore carries the same columns and related rows from its source
// whichever way it is made: the author names, the PDF, the license and the
// rights details, the attribution, the language, the provenance, the authors,
// the tags, the videos and the documents.
//
// Each route keeps its own rules: which sources it may copy, whether an
// existing copy is reused, the copy's title and its visibility, and the copy
// of the source's ready analyses (#1038). Once the copy is committed, all
// three queue its render by one rule, ensureCasePdfRenderJob in
// pdf-render-jobs-helper.js (#1088).

import fs from "fs/promises";
import path from "path";

import { uploadsPath } from "../config/uploads.config.js";
import { copyCaseDocuments } from "./case-documents.js";
import { copyCaseVideos } from "./case-videos.js";
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

const defaultUploadsRoot = path.resolve(process.cwd(), uploadsPath);

/**
 * The file of an upload's public path, `/uploads/...` or `assets/uploads/...`,
 * under the uploads root.
 *
 * @param {string|null} publicPath - The upload's public path.
 * @param {string} [uploadsRoot] - The absolute uploads root.
 * @returns {string|null} The absolute path, or null for an empty path or one
 *     that climbs out of the uploads root.
 */
export function uploadPublicPathToAbsolute(publicPath, uploadsRoot = defaultUploadsRoot) {
    const normalized = String(publicPath || "").replaceAll("\\", "/").replace(/^\/+/, "");
    const relativePath = normalized.startsWith("uploads/")
        ? normalized.slice("uploads/".length)
        : normalized.startsWith("assets/uploads/")
            ? normalized.slice("assets/uploads/".length)
            : normalized;

    if (!relativePath || relativePath.startsWith("../") || relativePath.includes("/../")) {
        return null;
    }

    return path.resolve(uploadsRoot, relativePath);
}

/**
 * Copies a case's PDF file to the copy's PDF path, creating its directory.
 * A failure is logged, and the caller then keeps the source's PDF path for the
 * copy.
 *
 * @param {string|null} sourcePdfPath - The source's PDF public path.
 * @param {string} destinationPdfPath - The copy's PDF public path.
 * @param {string} [uploadsRoot] - The absolute uploads root.
 * @returns {Promise<boolean>} Whether the file was copied.
 */
export async function copyCasePdfIfPresent(
    sourcePdfPath,
    destinationPdfPath,
    uploadsRoot = defaultUploadsRoot
) {
    const sourcePath = uploadPublicPathToAbsolute(sourcePdfPath, uploadsRoot);
    const destinationPath = uploadPublicPathToAbsolute(destinationPdfPath, uploadsRoot);
    if (!sourcePath || !destinationPath) {
        return false;
    }

    try {
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(sourcePath, destinationPath);
        return true;
    } catch (error) {
        console.warn("Unable to copy imported case PDF; retaining source PDF path.", {
            sourcePdfPath,
            destinationPdfPath,
            error: error.message,
        });
        return false;
    }
}

/**
 * Copies a case's authors, tags, videos and documents to its copy, inside the
 * caller's transaction. An author is linked to the account whose email matches
 * the author's, whatever the letter case; the tags are assigned by the copying
 * teacher; the videos and documents keep their order.
 *
 * @param {{query: Function}} client - The transaction's client.
 * @param {object} options
 * @param {number} options.sourceCaseId - The copied case.
 * @param {number} options.targetCaseId - The copy.
 * @param {number|string} options.assignedBy - The copying teacher.
 * @returns {Promise<void>}
 */
export async function copyCaseRelatedRows(client, { sourceCaseId, targetCaseId, assignedBy }) {
    await client.query(`
        INSERT INTO ethical_cases_authors (case_id, author_id, user_id, author_order, is_primary)
        SELECT $1,
               ca.author_id,
               u.id,
               ca.author_order,
               ca.is_primary
        FROM ethical_cases_authors ca
        INNER JOIN ethical_case_author a
            ON a.id = ca.author_id
        LEFT JOIN users u
            ON LOWER(u.mail) = LOWER(a.author_email)
        WHERE ca.case_id = $2
        ON CONFLICT (case_id, author_id) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            author_order = EXCLUDED.author_order,
            is_primary = EXCLUDED.is_primary,
            updated_at = NOW();
    `, [targetCaseId, sourceCaseId]);

    await client.query(`
        INSERT INTO ethical_cases_tags (case_id, tag_id, assigned_by)
        SELECT $1, ect.tag_id, $3
        FROM ethical_cases_tags ect
        WHERE ect.case_id = $2
        ON CONFLICT (case_id, tag_id) DO UPDATE
        SET assigned_by = EXCLUDED.assigned_by;
    `, [targetCaseId, sourceCaseId, assignedBy]);

    await copyCaseVideos(client, sourceCaseId, targetCaseId);
    await copyCaseDocuments(client, sourceCaseId, targetCaseId);
}

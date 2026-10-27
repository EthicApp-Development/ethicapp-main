import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { getUploadSha256 } from "./pdf-render-jobs-helper.js";

/**
 * The input of a design analysis (#848). Each design-scoped adapter exports
 *
 *     designAnalysisInput({ design, designCase }) => { input, hash } | null
 *
 * which says whether it applies to a design and, when it does, what its
 * generation works on (`input`, handed to its `design-created` and
 * `design-updated` handlers as `context.analysisInput`) and the hash of
 * everything that determines its result (`hash`, stored as
 * `design_analyses.input_hash`). EthicApp compares that hash with the stored
 * one to skip saves that do not change the result.
 * Adapters compute it with hashAnalysisInput() (helpers/analysis-input-hash.js)
 * and leave out what differs between a design and its copies, such as the
 * design and case ids, so copies keep their analyses.
 *
 * `designCase` describes the design's case without its text, which may still
 * be rendering when the design is saved: `contentHash` is the SHA-256 of the
 * case PDF, which determines the text. A copied case has the same PDF, so the
 * same hash. Adapters that need the text wait for it in their handler
 * (waitForCaseDocumentText()).
 */

async function getCaseRow(caseId) {
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT c.id, c.title, c.language_code, c.pdf_path,
                   prj.source_sha256
            FROM ethical_cases AS c
            LEFT JOIN pdf_render_jobs AS prj
                ON prj.owner_type = 'case'
               AND prj.owner_id = c.id
               AND prj.source_path = c.pdf_path
            WHERE c.id = $1;
        `,
        sqlParams: [caseId],
    });

    return rows[0] || null;
}

async function hashCasePdf(pdfPath) {
    try {
        return `sha256:${await getUploadSha256(pdfPath)}`;
    } catch (error) {
        console.warn("[design-analyses] Could not hash the case PDF.", { pdfPath, error });
        return null;
    }
}

/**
 * The case of a design, as design analysis adapters receive it.
 *
 * @param {number|null} caseId
 * @param {Object} [dependencies] - Overrides for tests.
 * @returns {Promise<{id: number, title: string|null, languageCode: string|null,
 *     contentHash: string|null}|null>} null when the design has no case.
 *     `contentHash` is null when the case has no readable PDF.
 */
export async function loadDesignCase(
    caseId,
    { getCase = getCaseRow, hashPdf = hashCasePdf } = {}
) {
    if (!caseId) {
        return null;
    }

    const row = await getCase(caseId);
    if (!row) {
        return null;
    }

    // The render job records the PDF's hash; without one, hash the file.
    let contentHash = null;
    if (row.source_sha256) {
        contentHash = `sha256:${row.source_sha256}`;
    } else if (row.pdf_path) {
        contentHash = await hashPdf(row.pdf_path);
    }

    return {
        id:           Number(row.id),
        title:        row.title ?? null,
        languageCode: row.language_code ?? null,
        contentHash,
    };
}

export function parseDesignDocument(value) {
    if (typeof value !== "string") {
        return value ?? null;
    }
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/**
 * Runs an adapter's designAnalysisInput() and checks what it returns.
 *
 * @param {Function} buildInput - The adapter's designAnalysisInput export.
 * @param {Object} args - `{ design, designCase }`.
 * @returns {Promise<{input: unknown, hash: string}|null>} null when the
 *     adapter does not apply to the design.
 * @throws {TypeError} When the adapter returns something else.
 */
export async function buildDesignAnalysisInput(buildInput, { design, designCase }) {
    const result = await buildInput({ design, designCase });
    if (result === null || result === undefined) {
        return null;
    }

    if (typeof result.hash !== "string" || result.hash === "") {
        throw new TypeError(
            "designAnalysisInput() must return { input, hash } with a hash, or null."
        );
    }

    return { input: result.input ?? null, hash: result.hash };
}

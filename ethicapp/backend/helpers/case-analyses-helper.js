import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

/**
 * Persistence of case analyses (see V17__case_analyses.sql): the current
 * result of each service chosen for a case.
 *
 * Updates that come from adapters are conditional on the job of the latest
 * generation, so results of superseded generations never overwrite newer
 * state, and teacher edits are not mixed with a running generation.
 */

// A generation that has not answered within this window is considered lost:
// the teacher may save edits or request a new generation again.
export const STALE_PROCESSING_INTERVAL = "15 minutes";

const summaryColumns = `
    case_id,
    service_id,
    status,
    document_schema,
    error_code,
    error_message,
    requested_at,
    generated_at,
    reviewed_at,
    updated_at,
    (status = 'processing'
        AND updated_at < now() - interval '${STALE_PROCESSING_INTERVAL}') AS is_stale
`;

const analysisColumns = `
    ${summaryColumns},
    document,
    job_id,
    requested_by,
    reviewed_by
`;

async function queryRows(sql, sqlParams, query) {
    return query({
        dbcon: config.dbconnString,
        sql,
        sqlParams,
    });
}

async function queryOne(sql, sqlParams, query) {
    const rows = await queryRows(sql, sqlParams, query);
    return rows[0] || null;
}

/**
 * Records the services a teacher chose when creating a case, one 'requested'
 * row each. Choices that already exist are left as they are.
 */
export async function insertRequestedCaseAnalyses(
    { caseId, serviceIds, userId },
    query = rpg2.execSQL
) {
    if (serviceIds.length === 0) {
        return [];
    }

    return queryRows(`
        INSERT INTO case_analyses (case_id, service_id, requested_by)
        SELECT $1, service_id, $3
        FROM unnest($2::text[]) AS service_id
        ON CONFLICT (case_id, service_id) DO NOTHING
        RETURNING ${summaryColumns};
    `, [caseId, serviceIds, userId], query);
}

// Lists the analyses of a case without their documents.
export async function listCaseAnalyses(caseId, query = rpg2.execSQL) {
    return queryRows(`
        SELECT ${summaryColumns}
        FROM case_analyses
        WHERE case_id = $1
        ORDER BY requested_at, service_id;
    `, [caseId], query);
}

export async function getCaseAnalysis({ caseId, serviceId }, query = rpg2.execSQL) {
    return queryOne(`
        SELECT ${analysisColumns}
        FROM case_analyses
        WHERE case_id = $1
          AND service_id = $2;
    `, [caseId, serviceId], query);
}

/**
 * Starts a generation: records the job whose result will apply. The previous
 * document is kept until that result arrives. Returns null when the service
 * was not chosen for the case.
 */
export async function markCaseAnalysisProcessing(
    { caseId, serviceId, jobId },
    query = rpg2.execSQL
) {
    return queryOne(`
        UPDATE case_analyses
        SET status = 'processing',
            job_id = $3::uuid,
            error_code = NULL,
            error_message = NULL,
            updated_at = now()
        WHERE case_id = $1
          AND service_id = $2
        RETURNING ${summaryColumns};
    `, [caseId, serviceId, jobId], query);
}

/**
 * Stores a generated document, which replaces the previous document and its
 * review. Returns null when the job is no longer the current generation.
 */
export async function completeCaseAnalysis(
    { serviceId, jobId, documentSchema, document },
    query = rpg2.execSQL
) {
    return queryOne(`
        UPDATE case_analyses
        SET status = 'ready',
            document_schema = $3,
            document = $4::jsonb,
            error_code = NULL,
            error_message = NULL,
            generated_at = now(),
            reviewed_at = NULL,
            reviewed_by = NULL,
            updated_at = now()
        WHERE service_id = $1
          AND job_id = $2::uuid
          AND status = 'processing'
        RETURNING ${summaryColumns};
    `, [serviceId, jobId, documentSchema, JSON.stringify(document)], query);
}

/**
 * Records a failed generation. An existing document is kept and the analysis
 * stays 'ready'; only analyses without a document become 'failed'. Returns
 * null when the job is no longer the current generation.
 */
export async function failCaseAnalysis(
    { serviceId, jobId, errorCode, errorMessage },
    query = rpg2.execSQL
) {
    return queryOne(`
        UPDATE case_analyses
        SET status = CASE WHEN document IS NULL THEN 'failed' ELSE 'ready' END,
            error_code = $3,
            error_message = $4,
            updated_at = now()
        WHERE service_id = $1
          AND job_id = $2::uuid
          AND status = 'processing'
        RETURNING ${summaryColumns};
    `, [serviceId, jobId, errorCode ?? null, errorMessage ?? null], query);
}

/**
 * Stores a document edited by the teacher. Returns null while a generation is
 * in flight (unless it is stale), so a late result cannot be mixed with the
 * edits, and when the service was not chosen for the case.
 */
export async function saveReviewedCaseAnalysis(
    { caseId, serviceId, documentSchema, document, userId },
    query = rpg2.execSQL
) {
    return queryOne(`
        UPDATE case_analyses
        SET status = 'ready',
            document_schema = $3,
            document = $4::jsonb,
            job_id = NULL,
            error_code = NULL,
            error_message = NULL,
            reviewed_at = now(),
            reviewed_by = $5,
            updated_at = now()
        WHERE case_id = $1
          AND service_id = $2
          AND (status <> 'processing'
               OR updated_at < now() - interval '${STALE_PROCESSING_INTERVAL}')
        RETURNING ${summaryColumns};
    `, [caseId, serviceId, documentSchema, JSON.stringify(document), userId], query);
}

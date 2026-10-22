import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

/**
 * Persistence of case analyses (see V17__case_analyses.sql): the current
 * result of each service chosen for a case.
 *
 * A generation is reserved before it is dispatched: one conditional update
 * marks the row 'requested' under a new job id, so concurrent requests cannot
 * both be accepted and teacher edits are refused until the generation ends.
 * Updates that come from adapters are conditional on that job id, so results
 * of superseded generations never overwrite newer state.
 */

// A generation that has not answered within this window is considered lost:
// the teacher may save edits or request a new generation again.
export const STALE_GENERATION_INTERVAL = "15 minutes";

// Recorded on a reservation that its adapter did not start.
const NOT_STARTED_ERROR_CODE    = "generation-not-started";
const NOT_STARTED_ERROR_MESSAGE = "The analysis service did not start the generation.";

const IN_FLIGHT_STATUSES = "status IN ('requested', 'processing')";

// Rows whose generation may still deliver a result.
const GENERATION_IN_FLIGHT = `(${IN_FLIGHT_STATUSES}
    AND updated_at >= now() - interval '${STALE_GENERATION_INTERVAL}')`;

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
    (${IN_FLIGHT_STATUSES}
        AND updated_at < now() - interval '${STALE_GENERATION_INTERVAL}') AS is_stale
`;

// The job id lets the caller dispatch the generation it reserved.
const reservationColumns = `
    ${summaryColumns},
    job_id
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
 * row each, already reserved for the first generation under a new job id.
 * Choices that already exist are left as they are, so only the returned rows
 * are reserved.
 */
export async function insertRequestedCaseAnalyses(
    { caseId, serviceIds, userId },
    query = rpg2.execSQL
) {
    if (serviceIds.length === 0) {
        return [];
    }

    return queryRows(`
        INSERT INTO case_analyses (case_id, service_id, job_id, requested_by)
        SELECT $1, service_id, gen_random_uuid(), $3
        FROM unnest($2::text[]) AS service_id
        ON CONFLICT (case_id, service_id) DO NOTHING
        RETURNING ${reservationColumns};
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
 * Reserves a new generation under a new job id, which becomes the only job
 * whose result applies. The previous document is kept until that result
 * arrives. Returns null while another generation is in flight (unless it is
 * stale), and when the service was not chosen for the case.
 */
export async function reserveCaseAnalysisGeneration(
    { caseId, serviceId },
    query = rpg2.execSQL
) {
    return queryOne(`
        UPDATE case_analyses
        SET status = 'requested',
            job_id = gen_random_uuid(),
            error_code = NULL,
            error_message = NULL,
            updated_at = now()
        WHERE case_id = $1
          AND service_id = $2
          AND NOT ${GENERATION_IN_FLIGHT}
        RETURNING ${reservationColumns};
    `, [caseId, serviceId], query);
}

/**
 * Starts the reserved generation of the given job. Returns null when that job
 * is no longer the reserved one: a newer generation or a teacher edit replaced
 * it, or it already started.
 */
export async function markCaseAnalysisProcessing(
    { caseId, serviceId, jobId },
    query = rpg2.execSQL
) {
    return queryOne(`
        UPDATE case_analyses
        SET status = 'processing',
            updated_at = now()
        WHERE case_id = $1
          AND service_id = $2
          AND job_id = $3::uuid
          AND status = 'requested'
        RETURNING ${summaryColumns};
    `, [caseId, serviceId, jobId], query);
}

/**
 * Releases a reservation that its adapter did not start, so it does not block
 * the analysis until it is stale. It ends like a failed generation: an
 * existing document is kept (the status returns to 'ready') and the error
 * records why. Returns null when the reservation was started or replaced.
 */
export async function releaseUnstartedCaseAnalysis(
    { caseId, serviceId, jobId },
    query = rpg2.execSQL
) {
    return queryOne(`
        UPDATE case_analyses
        SET status = CASE WHEN document IS NULL THEN 'failed' ELSE 'ready' END,
            error_code = $4,
            error_message = $5,
            updated_at = now()
        WHERE case_id = $1
          AND service_id = $2
          AND job_id = $3::uuid
          AND status = 'requested'
        RETURNING ${summaryColumns};
    `, [caseId, serviceId, jobId, NOT_STARTED_ERROR_CODE, NOT_STARTED_ERROR_MESSAGE], query);
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
 * in flight, from its reservation until its result (unless it is stale), so an
 * accepted generation cannot replace the edits; also when the service was not
 * chosen for the case. Dropping the job id discards any stale generation.
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
          AND NOT ${GENERATION_IN_FLIGHT}
        RETURNING ${summaryColumns};
    `, [caseId, serviceId, documentSchema, JSON.stringify(document), userId], query);
}

import * as rpg2 from "../db/rest-pg-2.js";
import {
    createAnalysesStore,
    generationInFlight,
    queryOne,
    queryRows,
    STALE_GENERATION_INTERVAL,
} from "./analyses-store-helper.js";

/**
 * Persistence of case analyses (see V21__case_analyses.sql): the current
 * result of each service chosen for a case.
 *
 * A generation is reserved before it is dispatched: one conditional update
 * marks the row 'requested' under a new job id, so concurrent requests cannot
 * both be accepted and teacher edits are refused until the generation ends.
 * Updates that come from adapters are conditional on that job id, so results
 * of superseded generations never overwrite newer state. Those statements are
 * shared with design analyses (analyses-store-helper.js).
 */

export { STALE_GENERATION_INTERVAL };

const store = createAnalysesStore({ table: "case_analyses", ownerColumn: "case_id" });

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
        RETURNING ${store.reservationColumns};
    `, [caseId, serviceIds, userId], query);
}

// Lists the analyses of a case without their documents.
export async function listCaseAnalyses(caseId, query = rpg2.execSQL) {
    return store.list(caseId, query);
}

export async function getCaseAnalysis({ caseId, serviceId }, query = rpg2.execSQL) {
    return store.get({ ownerId: caseId, serviceId }, query);
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
          AND NOT ${generationInFlight()}
        RETURNING ${store.reservationColumns};
    `, [caseId, serviceId], query);
}

// Starts the reserved generation of the given job (see markProcessing in
// analyses-store-helper.js).
export async function markCaseAnalysisProcessing(
    { caseId, serviceId, jobId },
    query = rpg2.execSQL
) {
    return store.markProcessing({ ownerId: caseId, serviceId, jobId }, query);
}

// Releases a reservation that its adapter did not start (see releaseUnstarted
// in analyses-store-helper.js).
export async function releaseUnstartedCaseAnalysis(
    { caseId, serviceId, jobId },
    query = rpg2.execSQL
) {
    return store.releaseUnstarted({ ownerId: caseId, serviceId, jobId }, query);
}

// Stores a generated document, which replaces the previous document and its
// review. Returns null when the job is no longer the current generation.
export async function completeCaseAnalysis(
    { serviceId, jobId, documentSchema, document },
    query = rpg2.execSQL
) {
    return store.complete({ serviceId, jobId, documentSchema, document }, query);
}

// Records a failed generation, keeping an existing document. Returns null when
// the job is no longer the current generation.
export async function failCaseAnalysis(
    { serviceId, jobId, errorCode, errorMessage },
    query = rpg2.execSQL
) {
    return store.fail({ serviceId, jobId, errorCode, errorMessage }, query);
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
    return store.saveReviewed(
        { ownerId: caseId, serviceId, documentSchema, document, userId },
        query
    );
}

import * as rpg2 from "../db/rest-pg-2.js";
import {
    createAnalysesStore,
    generationInFlight,
    queryOne,
    STALE_GENERATION_INTERVAL,
} from "./analyses-store-helper.js";

/**
 * Persistence of design analyses (see V25__design_analyses.sql): the current
 * result of each design-scoped service for a design, one row per design and
 * service, stored outside the design document.
 *
 * Generations follow the same lifecycle as case analyses
 * (analyses-store-helper.js): one conditional statement reserves a generation
 * under a new job id, and updates that come from adapters are conditional on
 * that job id, so results of superseded generations never overwrite newer
 * state. Unlike case analyses, rows are not chosen in advance: the first
 * reservation of a service for a design creates its row.
 */

export { STALE_GENERATION_INTERVAL };

const store = createAnalysesStore({
    table:               "design_analyses",
    ownerColumn:         "design_id",
    extraSummaryColumns: ["input_hash"],
});

// Lists the analyses of a design without their documents.
export async function listDesignAnalyses(designId, query = rpg2.execSQL) {
    return store.list(designId, query);
}

export async function getDesignAnalysis({ designId, serviceId }, query = rpg2.execSQL) {
    return store.get({ ownerId: designId, serviceId }, query);
}

/**
 * Reserves a new generation under a new job id, which becomes the only job
 * whose result applies. The first reservation of a service for a design
 * creates its row; later ones keep the previous document until the new result
 * arrives. `inputHash` records the input of this generation (null when the
 * caller computed none), and the request time and user are those of this
 * generation. Returns null while another generation is in flight (unless it
 * is stale).
 *
 * The check and the reservation are one statement, so of two concurrent
 * requests only one is accepted.
 */
export async function reserveDesignAnalysisGeneration(
    { designId, serviceId, inputHash = null, userId = null },
    query = rpg2.execSQL
) {
    // `da` names the existing row, which ON CONFLICT DO UPDATE sees next to
    // EXCLUDED (the proposed one).
    return queryOne(`
        INSERT INTO design_analyses AS da
            (design_id, service_id, job_id, input_hash, requested_by)
        VALUES ($1, $2, gen_random_uuid(), $3, $4)
        ON CONFLICT (design_id, service_id) DO UPDATE
        SET status = 'requested',
            job_id = EXCLUDED.job_id,
            input_hash = EXCLUDED.input_hash,
            requested_by = EXCLUDED.requested_by,
            requested_at = now(),
            error_code = NULL,
            error_message = NULL,
            updated_at = now()
        WHERE NOT ${generationInFlight("da")}
        RETURNING ${store.reservationColumns};
    `, [designId, serviceId, inputHash, userId], query);
}

// Starts the reserved generation of the given job. Returns null when that job
// is no longer the reserved one.
export async function markDesignAnalysisProcessing(
    { designId, serviceId, jobId },
    query = rpg2.execSQL
) {
    return store.markProcessing({ ownerId: designId, serviceId, jobId }, query);
}

// Releases a reservation that its adapter did not start, so it does not block
// the analysis until it is stale. Returns null when it was started or replaced.
export async function releaseUnstartedDesignAnalysis(
    { designId, serviceId, jobId },
    query = rpg2.execSQL
) {
    return store.releaseUnstarted({ ownerId: designId, serviceId, jobId }, query);
}

// Stores a generated document, which replaces the previous document and its
// review. Returns null when the job is no longer the current generation.
export async function completeDesignAnalysis(
    { serviceId, jobId, documentSchema, document },
    query = rpg2.execSQL
) {
    return store.complete({ serviceId, jobId, documentSchema, document }, query);
}

// Records a failed generation, keeping an existing document. Returns null when
// the job is no longer the current generation.
export async function failDesignAnalysis(
    { serviceId, jobId, errorCode, errorMessage },
    query = rpg2.execSQL
) {
    return store.fail({ serviceId, jobId, errorCode, errorMessage }, query);
}

/**
 * Stores a document edited by the teacher, for services whose adapter
 * validates edits. Returns null while a generation is in flight (unless it is
 * stale) and when the design has no analysis of the service.
 */
export async function saveReviewedDesignAnalysis(
    { designId, serviceId, documentSchema, document, userId },
    query = rpg2.execSQL
) {
    return store.saveReviewed(
        { ownerId: designId, serviceId, documentSchema, document, userId },
        query
    );
}

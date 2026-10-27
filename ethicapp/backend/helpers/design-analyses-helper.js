import * as rpg2 from "../db/rest-pg-2.js";
import {
    createAnalysesStore,
    generationInFlight,
    queryOne,
    queryRows,
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
 * The fingerprint of a stored design document, as reservations compare it
 * (`design_fingerprint`). Readers of a design whose input becomes a
 * reservation select it next to the document, and pass it back unchanged with
 * the case id as the design snapshot. PostgreSQL computes both sides from the
 * stored jsonb, whose text form is canonical, so equal documents always have
 * equal fingerprints.
 */
export function designFingerprintSql(alias = "d") {
    return `md5(${alias}.design::text)`;
}

/**
 * One statement that reserves a new generation under a new job id, creating
 * the row on the first reservation, unless `refusal` holds for the existing
 * row (`da`, next to EXCLUDED, the proposed one), or the design no longer
 * matches the snapshot the input was prepared from (#848).
 *
 * The design check locks the design row (FOR SHARE) for the statement, so it
 * is ordered with saves (PATCH /designs/:id updates the row): under READ
 * COMMITTED, a design updated and committed since the statement began is
 * re-checked in its latest version, and an update in progress is waited for.
 * Either the reservation runs before a newer save's update, and that save's
 * own reservation, which comes after its update, supersedes it; or it runs
 * after the update and is rejected. A locked design is rejected too.
 *
 * The result always has one row: `design_current`, and the reservation's
 * columns, which are NULL when nothing was reserved.
 */
function reservationSql(refusal) {
    return `
        WITH current_design AS (
            SELECT d.id
            FROM designs AS d
            WHERE d.id = $1::integer
              AND ${designFingerprintSql("d")} IS NOT DISTINCT FROM $5::text
              AND d.case_id IS NOT DISTINCT FROM $6::integer
              AND d.locked IS NOT TRUE
            FOR SHARE
        ),
        reserved AS (
            INSERT INTO design_analyses AS da
                (design_id, service_id, job_id, input_hash, requested_by)
            SELECT current_design.id, $2::text, gen_random_uuid(), $3::text, $4::integer
            FROM current_design
            ON CONFLICT (design_id, service_id) DO UPDATE
            SET status = 'requested',
                job_id = EXCLUDED.job_id,
                input_hash = EXCLUDED.input_hash,
                requested_by = EXCLUDED.requested_by,
                requested_at = now(),
                error_code = NULL,
                error_message = NULL,
                updated_at = now()
            WHERE NOT (${refusal})
            RETURNING ${store.reservationColumns}
        )
        SELECT EXISTS (SELECT 1 FROM current_design) AS design_current, reserved.*
        FROM (SELECT 1) AS single_row
        LEFT JOIN reserved ON true;
    `;
}

function checkDesignSnapshot(designSnapshot) {
    if (!designSnapshot || typeof designSnapshot !== "object"
        || !Object.hasOwn(designSnapshot, "fingerprint")) {
        throw new TypeError(
            "A design analysis reservation needs the design snapshot it was prepared from."
        );
    }
}

async function reserve(refusal, { designId, serviceId, inputHash, userId, designSnapshot }, query) {
    checkDesignSnapshot(designSnapshot);

    const row = await queryOne(reservationSql(refusal), [
        designId,
        serviceId,
        inputHash,
        userId,
        designSnapshot.fingerprint ?? null,
        designSnapshot.caseId ?? null,
    ], query);

    const { design_current: designCurrent, ...reservation } = row ?? {};
    return {
        designChanged: designCurrent !== true,
        reservation:   reservation.job_id ? reservation : null,
    };
}

/**
 * The condition of rows whose latest generation, for their `input_hash`,
 * succeeded: they are ready and that generation recorded no error. A ready
 * row with an error holds the document of an earlier input, because a failed
 * or unstarted generation keeps the existing document.
 */
const SUCCEEDED_FOR_INPUT_HASH = "(da.status = 'ready' AND da.error_code IS NULL)";

/**
 * Reserves a new generation under a new job id, which becomes the only job
 * whose result applies. The first reservation of a service for a design
 * creates its row; later ones keep the previous document until the new result
 * arrives. `inputHash` records the input of this generation (null when the
 * adapter computes none), and the request time and user are those of this
 * generation.
 *
 * `designSnapshot` is `{ fingerprint, caseId }` of the design row the input
 * was prepared from (`design_fingerprint` and `case_id`, see
 * designFingerprintSql()). Nothing is reserved when the design changed since,
 * or was locked (`designChanged: true`), nor while another generation is in
 * flight, unless it is stale (`reservation: null`).
 *
 * This is the explicit regeneration: it runs whatever the stored input hash.
 * The checks and the reservation are one statement, so of two concurrent
 * requests only one is accepted.
 *
 * @returns {Promise<{designChanged: boolean, reservation: Object|null}>}
 */
export async function reserveDesignAnalysisGeneration(
    { designId, serviceId, inputHash = null, userId = null, designSnapshot },
    query = rpg2.execSQL
) {
    return reserve(
        generationInFlight("da"),
        { designId, serviceId, inputHash, userId, designSnapshot },
        query
    );
}

/**
 * Reserves a generation for a saved design (#848), whose adapter computed
 * `inputHash` from the design snapshot `designSnapshot` (as for
 * reserveDesignAnalysisGeneration()). Nothing is reserved when the design
 * changed since (`designChanged: true`): a newer save owns the analysis.
 * Nothing is reserved either (`reservation: null`) when the stored analysis
 * already covers that input: its `input_hash` is the same and its generation
 * either succeeded or is still in flight (and not stale). Otherwise it
 * reserves a new generation, also while another one is in flight for a
 * different input: the new job id supersedes it, and the result of the older
 * job is discarded when it arrives, because its updates are conditional on
 * the job id.
 *
 * One statement checks and reserves, so of two concurrent saves with the same
 * input only one reserves a generation.
 *
 * @returns {Promise<{designChanged: boolean, reservation: Object|null}>}
 */
export async function reserveDesignAnalysisForSavedInput(
    { designId, serviceId, inputHash, userId = null, designSnapshot },
    query = rpg2.execSQL
) {
    if (typeof inputHash !== "string" || inputHash === "") {
        throw new TypeError("A design analysis requested on save needs an input hash.");
    }

    return reserve(
        // NULL-safe: a row stored without an input hash never matches.
        `da.input_hash IS NOT DISTINCT FROM EXCLUDED.input_hash
            AND (${generationInFlight("da")} OR ${SUCCEEDED_FOR_INPUT_HASH})`,
        { designId, serviceId, inputHash, userId, designSnapshot },
        query
    );
}

/**
 * Copies the ready analyses of a design to a copy of it (duplicate or import,
 * #848): the document, its schema, the input hash and the generation time,
 * plus the error of a latest generation that failed while keeping the
 * document, so the copy knows that document is not the one of its input hash.
 * Review fields, job ids and requesters are not copied. Analyses that are not
 * ready (in flight or failed) are left out: the copy requests them as a save
 * would. Rows the copy already has are kept. Returns the copied service ids
 * as rows.
 *
 * `query` runs the statement inside the transaction that creates the copy.
 */
export async function copyReadyDesignAnalyses(
    { sourceDesignId, targetDesignId },
    query = rpg2.execSQL
) {
    return queryRows(`
        INSERT INTO design_analyses
            (design_id, service_id, status, document_schema, document,
             input_hash, error_code, error_message, requested_at, generated_at)
        SELECT $2, source.service_id, 'ready', source.document_schema,
               source.document, source.input_hash, source.error_code,
               source.error_message, source.requested_at, source.generated_at
        FROM design_analyses AS source
        WHERE source.design_id = $1
          AND source.status = 'ready'
          AND source.document IS NOT NULL
        ON CONFLICT (design_id, service_id) DO NOTHING
        RETURNING service_id;
    `, [sourceDesignId, targetDesignId], query);
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

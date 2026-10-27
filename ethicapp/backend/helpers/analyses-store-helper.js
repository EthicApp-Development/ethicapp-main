import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

/**
 * What case analyses (case_analyses) and design analyses (design_analyses)
 * share: one row per owner and service holding the current result of that
 * service, the generation lifecycle (requested, processing, ready, failed),
 * the stale window, and the updates whose conditions keep superseded
 * generations from overwriting newer state.
 *
 * Each table helper binds these statements to its table and owner column
 * (case_id or design_id) and keeps what differs: how a generation is reserved.
 */

// A generation that has not answered within this window is considered lost:
// the teacher may save edits or request a new generation again.
export const STALE_GENERATION_INTERVAL = "15 minutes";

// Recorded on a reservation that its adapter did not start.
export const NOT_STARTED_ERROR_CODE    = "generation-not-started";
export const NOT_STARTED_ERROR_MESSAGE = "The analysis service did not start the generation.";

const IN_FLIGHT_STATUSES = "status IN ('requested', 'processing')";

const qualified = (alias, column) => (alias ? `${alias}.${column}` : column);

/**
 * The condition of rows whose generation may still deliver a result: it is
 * reserved or started and not stale. `alias` qualifies the columns where the
 * statement has more than one row in scope (ON CONFLICT ... DO UPDATE).
 */
export function generationInFlight(alias = "") {
    const status    = qualified(alias, "status");
    const updatedAt = qualified(alias, "updated_at");
    return `(${status} IN ('requested', 'processing')
    AND ${updatedAt} >= now() - interval '${STALE_GENERATION_INTERVAL}')`;
}

/**
 * The columns every listing returns, without the document. `extraColumns`
 * go after the generic ones and before the computed `is_stale`.
 */
export function analysisSummaryColumns(ownerColumn, extraColumns = []) {
    const extra = extraColumns.map(column => `    ${column},\n`).join("");
    return `
    ${ownerColumn},
    service_id,
    status,
    document_schema,
${extra}    error_code,
    error_message,
    requested_at,
    generated_at,
    reviewed_at,
    updated_at,
    (${IN_FLIGHT_STATUSES}
        AND updated_at < now() - interval '${STALE_GENERATION_INTERVAL}') AS is_stale
`;
}

export async function queryRows(sql, sqlParams, query) {
    return query({
        dbcon: config.dbconnString,
        sql,
        sqlParams,
    });
}

export async function queryOne(sql, sqlParams, query) {
    const rows = await queryRows(sql, sqlParams, query);
    return rows[0] || null;
}

/**
 * The statements shared by the analyses tables, bound to `table` and to its
 * `ownerColumn`. Each function takes `{ ownerId, ... }` and an optional
 * `query` (rpg2.execSQL by default), so tests can record the SQL.
 *
 * @param {Object} options
 * @param {string} options.table - `case_analyses` or `design_analyses`.
 * @param {string} options.ownerColumn - `case_id` or `design_id`.
 * @param {string[]} [options.extraSummaryColumns] - Table-specific columns.
 */
export function createAnalysesStore({ table, ownerColumn, extraSummaryColumns = [] }) {
    const summaryColumns = analysisSummaryColumns(ownerColumn, extraSummaryColumns);

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

    return {
        summaryColumns,
        reservationColumns,

        // Lists the analyses of an owner without their documents.
        list: (ownerId, query = rpg2.execSQL) => queryRows(`
        SELECT ${summaryColumns}
        FROM ${table}
        WHERE ${ownerColumn} = $1
        ORDER BY requested_at, service_id;
    `, [ownerId], query),

        get: ({ ownerId, serviceId }, query = rpg2.execSQL) => queryOne(`
        SELECT ${analysisColumns}
        FROM ${table}
        WHERE ${ownerColumn} = $1
          AND service_id = $2;
    `, [ownerId, serviceId], query),

        /**
         * Starts the reserved generation of the given job. Returns null when
         * that job is no longer the reserved one: a newer generation or a
         * teacher edit replaced it, or it already started.
         */
        markProcessing: ({ ownerId, serviceId, jobId }, query = rpg2.execSQL) => queryOne(`
        UPDATE ${table}
        SET status = 'processing',
            updated_at = now()
        WHERE ${ownerColumn} = $1
          AND service_id = $2
          AND job_id = $3::uuid
          AND status = 'requested'
        RETURNING ${summaryColumns};
    `, [ownerId, serviceId, jobId], query),

        /**
         * Releases a reservation that its adapter did not start, so it does
         * not block the analysis until it is stale. It ends like a failed
         * generation: an existing document is kept (the status returns to
         * 'ready') and the error records why. Returns null when the
         * reservation was started or replaced.
         */
        releaseUnstarted: ({ ownerId, serviceId, jobId }, query = rpg2.execSQL) => queryOne(`
        UPDATE ${table}
        SET status = CASE WHEN document IS NULL THEN 'failed' ELSE 'ready' END,
            error_code = $4,
            error_message = $5,
            updated_at = now()
        WHERE ${ownerColumn} = $1
          AND service_id = $2
          AND job_id = $3::uuid
          AND status = 'requested'
        RETURNING ${summaryColumns};
    `, [ownerId, serviceId, jobId, NOT_STARTED_ERROR_CODE, NOT_STARTED_ERROR_MESSAGE], query),

        /**
         * Stores a generated document, which replaces the previous document
         * and its review. Returns null when the job is no longer the current
         * generation. Job ids are unique, so the owner is not needed.
         */
        complete: ({ serviceId, jobId, documentSchema, document }, query = rpg2.execSQL) =>
            queryOne(`
        UPDATE ${table}
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
    `, [serviceId, jobId, documentSchema, JSON.stringify(document)], query),

        /**
         * Records a failed generation. An existing document is kept and the
         * analysis stays 'ready'; only analyses without a document become
         * 'failed'. Returns null when the job is no longer the current
         * generation.
         */
        fail: ({ serviceId, jobId, errorCode, errorMessage }, query = rpg2.execSQL) => queryOne(`
        UPDATE ${table}
        SET status = CASE WHEN document IS NULL THEN 'failed' ELSE 'ready' END,
            error_code = $3,
            error_message = $4,
            updated_at = now()
        WHERE service_id = $1
          AND job_id = $2::uuid
          AND status = 'processing'
        RETURNING ${summaryColumns};
    `, [serviceId, jobId, errorCode ?? null, errorMessage ?? null], query),

        /**
         * Stores a document edited by the teacher. Returns null while a
         * generation is in flight, from its reservation until its result
         * (unless it is stale), so an accepted generation cannot replace the
         * edits; also when the row does not exist. Dropping the job id
         * discards any stale generation.
         */
        saveReviewed: (
            { ownerId, serviceId, documentSchema, document, userId },
            query = rpg2.execSQL
        ) => queryOne(`
        UPDATE ${table}
        SET status = 'ready',
            document_schema = $3,
            document = $4::jsonb,
            job_id = NULL,
            error_code = NULL,
            error_message = NULL,
            reviewed_at = now(),
            reviewed_by = $5,
            updated_at = now()
        WHERE ${ownerColumn} = $1
          AND service_id = $2
          AND NOT ${generationInFlight()}
        RETURNING ${summaryColumns};
    `, [ownerId, serviceId, documentSchema, JSON.stringify(document), userId], query),
    };
}

import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

/**
 * Persistence of case evidence inventories (see V17__case_evidence_inventories.sql).
 *
 * Updates are conditional so that results of superseded generation requests
 * and teacher edits during a generation never overwrite newer state.
 */

// A generation that has not answered within this window is considered lost:
// the teacher may save edits or request a new generation again.
export const STALE_PROCESSING_INTERVAL = "15 minutes";

const inventoryColumns = `
    case_id,
    status,
    inventory,
    service_id,
    job_id,
    error_message,
    generated_at,
    reviewed_at,
    reviewed_by,
    updated_at,
    (status = 'processing'
        AND updated_at < now() - interval '${STALE_PROCESSING_INTERVAL}') AS is_stale
`;

function rowOrNull(row) {
    return row?.case_id ? row : null;
}

export async function getCaseEvidenceInventory(caseId) {
    const row = await rpg2.singleSQL({
        dbcon:     config.dbconnString,
        sql:       `SELECT ${inventoryColumns} FROM case_evidence_inventories WHERE case_id = $1;`,
        sqlParams: [rpg2.param("plain", caseId)],
    });

    return rowOrNull(row);
}

/**
 * Starts a generation: records the job that will answer. The previous
 * inventory is kept until the result arrives.
 */
export async function markEvidenceInventoryProcessing({ caseId, serviceId, jobId }) {
    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            INSERT INTO case_evidence_inventories (case_id, status, service_id, job_id)
            VALUES ($1, 'processing', $2, $3::uuid)
            ON CONFLICT (case_id)
            DO UPDATE SET
                status = 'processing',
                service_id = EXCLUDED.service_id,
                job_id = EXCLUDED.job_id,
                error_message = NULL,
                updated_at = now()
            RETURNING ${inventoryColumns};
        `,
        sqlParams: [
            rpg2.param("plain", caseId),
            rpg2.param("plain", serviceId),
            rpg2.param("plain", jobId),
        ],
    });

    return rowOrNull(row);
}

/**
 * Stores a generated draft, which replaces the previous inventory and its
 * review. Returns null when the job is no longer the current generation of
 * its case.
 */
export async function completeEvidenceInventoryJob({ jobId, inventory }) {
    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            UPDATE case_evidence_inventories
            SET status = 'draft',
                inventory = $2::jsonb,
                error_message = NULL,
                generated_at = now(),
                reviewed_at = NULL,
                reviewed_by = NULL,
                updated_at = now()
            WHERE job_id = $1::uuid
              AND status = 'processing'
            RETURNING ${inventoryColumns};
        `,
        sqlParams: [
            rpg2.param("plain", jobId),
            rpg2.param("plain", JSON.stringify(inventory)),
        ],
    });

    return rowOrNull(row);
}

/**
 * Records a failed generation. An existing inventory is kept with its status
 * (reviewed or draft), so only cases without an inventory become 'failed'.
 * Returns null when the job is no longer the current generation of its case.
 */
export async function failEvidenceInventoryJob({ jobId, errorMessage }) {
    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            UPDATE case_evidence_inventories
            SET status = CASE
                    WHEN inventory IS NULL THEN 'failed'
                    WHEN reviewed_at IS NOT NULL THEN 'reviewed'
                    ELSE 'draft'
                END,
                error_message = $2,
                updated_at = now()
            WHERE job_id = $1::uuid
              AND status = 'processing'
            RETURNING ${inventoryColumns};
        `,
        sqlParams: [
            rpg2.param("plain", jobId),
            rpg2.param("plain", errorMessage),
        ],
    });

    return rowOrNull(row);
}

/**
 * Stores the teacher-reviewed inventory. Returns null while a generation is
 * in flight (unless it is stale), so a late draft cannot be mixed with edits.
 */
export async function saveReviewedEvidenceInventory({ caseId, inventory, userId }) {
    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            INSERT INTO case_evidence_inventories
                (case_id, status, inventory, reviewed_at, reviewed_by)
            VALUES ($1, 'reviewed', $2::jsonb, now(), $3)
            ON CONFLICT (case_id)
            DO UPDATE SET
                status = 'reviewed',
                inventory = EXCLUDED.inventory,
                job_id = NULL,
                error_message = NULL,
                reviewed_at = now(),
                reviewed_by = EXCLUDED.reviewed_by,
                updated_at = now()
            WHERE case_evidence_inventories.status <> 'processing'
               OR case_evidence_inventories.updated_at
                  < now() - interval '${STALE_PROCESSING_INTERVAL}'
            RETURNING ${inventoryColumns};
        `,
        sqlParams: [
            rpg2.param("plain", caseId),
            rpg2.param("plain", JSON.stringify(inventory)),
            rpg2.param("plain", userId),
        ],
    });

    return rowOrNull(row);
}

// What the per-account anonymization step does about the AI services
// (epic #879, sub-issue #876). It runs inside the step's transaction, both
// when an administrator forgets a student and in the scheduled job.
//
// - Inside EthicApp, the jobs and callback results of the AI services keep
//   jsonb payloads that can carry the student's text (the tutor's callbacks
//   carry an argument preview and feedback about it). Every string value in
//   them is replaced with the placeholder; the structure, numbers, booleans
//   and the row itself are kept, so audits still count the work. See
//   deploy/student-anonymization-data-map.md for the payload inventory.
// - Outside EthicApp, AI Additions keeps what the student sent to the tutor
//   and to Polyadic. The step records one erasure request per AI Additions
//   service in user_erasure_requests (V29). ethicapp, which holds the AI
//   Additions credentials, processes them in the background through the
//   `user-forgotten` hook, with retries.

// AI Additions services that keep data about the students who used them,
// and so receive an erasure request for every forgotten student: the
// Argumentation Tutor (sessions and history in Redis) and Polyadic Agents
// (messages in PostgreSQL). Ids are AI Additions service ids, as in the AI
// service policy.
export const USER_ERASURE_SERVICE_IDS = Object.freeze([
    "argumentation-tutor",
    "polyadic-agent",
]);

const RESULT_PAYLOAD_COLUMNS = Object.freeze(["raw_payload", "sanitized_payload", "adapter_result"]);

/**
 * A copy of a JSON value with every string replaced by `placeholder`, at any
 * depth. Object keys, numbers, booleans and nulls are kept.
 * @param {unknown} value
 * @param {string} placeholder
 * @returns {unknown}
 */
export function redactJsonStrings(value, placeholder) {
    if (typeof value === "string") {
        return value === "" ? value : placeholder;
    }

    if (Array.isArray(value)) {
        return value.map(item => redactJsonStrings(item, placeholder));
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, redactJsonStrings(item, placeholder)])
        );
    }

    return value;
}

function sameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function jsonParam(value) {
    return value === null || value === undefined ? null : JSON.stringify(value);
}

/**
 * Replaces the strings in the AI service payloads of a user's jobs and
 * results. Only rows that change are written.
 * @param {{ query: Function }} client - A client inside the caller's transaction.
 * @returns {Promise<{ results: number, jobs: number }>} Rows changed.
 */
export async function eraseExternalServicePayloads(client, userId, placeholderText) {
    const resultRows = await client.query(
        `
            SELECT id, raw_payload, sanitized_payload, adapter_result
            FROM external_service_results
            WHERE user_id = $1
            FOR UPDATE
        `,
        [userId]
    );

    let results = 0;

    for (const row of resultRows.rows) {
        const redacted = Object.fromEntries(RESULT_PAYLOAD_COLUMNS.map(column => [
            column,
            redactJsonStrings(row[column], placeholderText),
        ]));

        if (RESULT_PAYLOAD_COLUMNS.every(column => sameJson(row[column], redacted[column]))) {
            continue;
        }

        await client.query(
            `
                UPDATE external_service_results
                SET raw_payload = $2::jsonb,
                    sanitized_payload = $3::jsonb,
                    adapter_result = $4::jsonb
                WHERE id = $1
            `,
            [
                row.id,
                jsonParam(redacted.raw_payload) ?? "{}",
                jsonParam(redacted.sanitized_payload),
                jsonParam(redacted.adapter_result),
            ]
        );
        results += 1;
    }

    // No adapter sets outbound_payload today; erase it should one ever do.
    const jobRows = await client.query(
        `
            SELECT id, outbound_payload
            FROM external_service_jobs
            WHERE user_id = $1
              AND outbound_payload IS NOT NULL
            FOR UPDATE
        `,
        [userId]
    );

    let jobs = 0;

    for (const row of jobRows.rows) {
        const redacted = redactJsonStrings(row.outbound_payload, placeholderText);

        if (sameJson(row.outbound_payload, redacted)) {
            continue;
        }

        await client.query(
            `
                UPDATE external_service_jobs
                SET outbound_payload = $2::jsonb,
                    updated_at = now()
                WHERE id = $1
            `,
            [row.id, jsonParam(redacted)]
        );
        jobs += 1;
    }

    return { results, jobs };
}

/**
 * Records a pending erasure request for each AI Additions service. A request
 * that already exists for the account (an earlier forgetting) is set back to
 * pending, since the account may have new data since then.
 * @param {{ query: Function }} client - A client inside the caller's transaction.
 * @param {number} userId
 * @param {number|null} runId - The anonymization run, for the audit trail.
 * @returns {Promise<string[]>} The service ids of the recorded requests.
 */
export async function recordUserErasureRequests(client, userId, runId = null) {
    await client.query(
        `
            INSERT INTO user_erasure_requests
                (user_id, service_id, anonymization_run_id)
            SELECT $1, service_id, $3
            FROM unnest($2::text[]) AS service_id
            ON CONFLICT (user_id, service_id) DO UPDATE
            SET status = 'pending',
                attempts = 0,
                next_attempt_at = now(),
                last_attempt_at = NULL,
                last_error = NULL,
                requested_at = now(),
                completed_at = NULL,
                anonymization_run_id = EXCLUDED.anonymization_run_id
        `,
        [userId, [...USER_ERASURE_SERVICE_IDS], runId]
    );

    return [...USER_ERASURE_SERVICE_IDS];
}

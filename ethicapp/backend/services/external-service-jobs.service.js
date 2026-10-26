import pkg from "pg";
import { dbconnString } from "../config/database.config.js";

const { Pool } = pkg;

export const JOB_STATUS = Object.freeze({
    PENDING:           "pending",
    DISPATCHED:        "dispatched",
    CALLBACK_RECEIVED: "callback-received",
    COMPLETED:         "completed",
    FAILED:            "failed",
    SKIPPED:           "skipped",
    EXPIRED:           "expired",
});

export const RESULT_STATUS = Object.freeze({
    CALLBACK_RECEIVED:   "callback-received",
    COMPLETED:           "completed",
    FAILED:              "failed",
    UNKNOWN_CORRELATION: "unknown-correlation",
    // Received, not yet consumed (#815). Every callback is recorded in this
    // state; claimResult() consumes it right before any handler runs, moving
    // it to callback-received or unknown-correlation. Until then a retry with
    // the same eventId is authorized again instead of being dropped.
    PENDING:             "pending",
});

const TERMINAL_JOB_STATUSES = new Set([
    JOB_STATUS.COMPLETED,
    JOB_STATUS.FAILED,
    JOB_STATUS.SKIPPED,
    JOB_STATUS.EXPIRED,
]);

let _pool = null;

function getPool() {
    if (!_pool) {
        _pool = new Pool({ connectionString: dbconnString });
    }
    return _pool;
}

async function poolQuery(sql, params = []) {
    const result = await getPool().query(sql, params);
    return result.rows;
}

export class ExternalServiceJobsService {
    constructor({ dbQuery } = {}) {
        this._db = dbQuery || poolQuery;
    }

    // `id` lets the caller choose the job id in advance, for work it has
    // already reserved under that id; without it the database generates one.
    async createJob({
        id              = null,
        serviceId,
        hookName,
        sessionId       = null,
        phaseId         = null,
        questionId      = null,
        groupId         = null,
        userId          = null,
        outboundPayload = null,
    }) {
        const rows = await this._db(
            `INSERT INTO external_service_jobs
                 (id, service_id, hook_name, status,
                  session_id, phase_id, question_id, group_id, user_id,
                  outbound_payload)
             VALUES (COALESCE($10::uuid, gen_random_uuid()),
                     $1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, service_id, hook_name, status,
                       session_id, phase_id, question_id, group_id, user_id,
                       created_at`,
            [
                serviceId, hookName, JOB_STATUS.PENDING,
                sessionId, phaseId, questionId, groupId, userId,
                outboundPayload, id,
            ]
        );
        return rows[0] || null;
    }

    async updateJobStatus(jobId, status, { dispatchedAt, completedAt } = {}) {
        const clauses = ["status = $2", "updated_at = now()"];
        const params  = [jobId, status];

        if (dispatchedAt !== undefined) {
            params.push(dispatchedAt);
            clauses.push(`dispatched_at = $${params.length}`);
        }
        if (completedAt !== undefined) {
            params.push(completedAt);
            clauses.push(`completed_at = $${params.length}`);
        }

        await this._db(
            `UPDATE external_service_jobs
             SET ${clauses.join(", ")}
             WHERE id = $1`,
            params
        );
    }

    // Stores what the AI service reported when the job instantiated it (#737).
    async recordInstantiationReport(jobId, report) {
        await this._db(
            `UPDATE external_service_jobs
             SET instantiation_report = $2::jsonb, updated_at = now()
             WHERE id = $1`,
            [jobId, JSON.stringify(report)]
        );
    }

    async recordProviderReference(jobId, providerReference) {
        await this._db(
            `UPDATE external_service_jobs
             SET provider_reference = $2, updated_at = now()
             WHERE id = $1`,
            [jobId, providerReference]
        );
    }

    async createResult({
        correlationId = null,
        serviceId,
        hookName      = "callback-received",
        rawPayload,
        eventId       = null,
        sessionId     = null,
        phaseId       = null,
        questionId    = null,
        groupId       = null,
        userId        = null,
    }) {
        let jobId        = null;
        let jobStatus    = null;
        let jobContext   = null;
        let correlatesOtherService = false;
        let resultStatus = RESULT_STATUS.UNKNOWN_CORRELATION;

        if (correlationId) {
            const matchRows = await this._db(
                `SELECT id, status, session_id, phase_id, question_id, group_id, user_id
                 FROM external_service_jobs
                 WHERE id::text = $1 AND service_id = $2`,
                [correlationId, serviceId]
            );
            if (matchRows.length === 0) {
                // A correlation id that names another service's job is
                // refused by the registry; an unknown one may be a proactive
                // callback (#815).
                const otherRows = await this._db(
                    "SELECT 1 FROM external_service_jobs WHERE id::text = $1",
                    [correlationId]
                );
                correlatesOtherService = otherRows.length > 0;
            }
            if (matchRows.length > 0) {
                const job    = matchRows[0];
                jobId        = job.id;
                jobStatus    = job.status;
                resultStatus = RESULT_STATUS.CALLBACK_RECEIVED;
                // The trusted destination of the callback: what the job was
                // dispatched for, never what the payload claims (#815).
                jobContext   = Object.freeze({
                    id:         job.id,
                    sessionId:  job.session_id  ?? null,
                    phaseId:    job.phase_id    ?? null,
                    questionId: job.question_id ?? null,
                    groupId:    job.group_id    ?? null,
                    userId:     job.user_id     ?? null,
                });
                // Propagate job context to result when caller did not provide it.
                sessionId    = sessionId  ?? job.session_id;
                phaseId      = phaseId    ?? job.phase_id;
                questionId   = questionId ?? job.question_id;
                groupId      = groupId    ?? job.group_id;
                userId       = userId     ?? job.user_id;
            }
        }

        // Every callback is recorded unconsumed (#815). Receipt writes nothing
        // else: the job is only advanced when the result is claimed.
        const rows = await this._db(
            `INSERT INTO external_service_results
                 (job_id, correlation_id, service_id, hook_name, status,
                  session_id, phase_id, question_id, group_id, user_id,
                  raw_payload, event_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (service_id, event_id) WHERE event_id IS NOT NULL
             DO NOTHING
             RETURNING id, job_id, correlation_id, service_id, hook_name,
                       status, received_at`,
            [
                jobId, correlationId, serviceId, hookName, RESULT_STATUS.PENDING,
                sessionId, phaseId, questionId, groupId, userId,
                rawPayload ?? {}, eventId,
            ]
        );

        let result = rows[0] || null;

        // Empty result with a provided eventId means (service_id, event_id)
        // already exists. A consumed one is a duplicate, as before. An
        // unconsumed one (an earlier attempt was refused before any handler
        // ran, or failed before it could consume it) is processed again, with
        // this attempt's correlation; claimResult() lets only one attempt
        // through.
        if (rows.length === 0 && eventId !== null) {
            const existing = await this._db(
                `SELECT id, job_id, correlation_id, service_id, hook_name, status, received_at
                 FROM external_service_results
                 WHERE service_id = $1 AND event_id = $2`,
                [serviceId, eventId]
            );
            const stored = existing[0] || null;
            if (!stored || stored.status !== RESULT_STATUS.PENDING) {
                if (stored) {
                    stored.is_duplicate = true;
                }
                return stored;
            }
            result = { ...stored, job_id: jobId, correlation_id: correlationId, is_retry: true };
        }

        if (result && jobContext) {
            result.job = jobContext;
        }
        if (result && correlatesOtherService) {
            result.correlates_other_service = true;
        }

        if (result && jobStatus !== null) {
            result.job_prior_status = jobStatus;
            // When eventId is absent, fall back to terminal-state replay protection so
            // existing integrations that omit eventId retain the same dedup behavior
            // they had before this feature was introduced.
            if (eventId === null) {
                result.is_duplicate = TERMINAL_JOB_STATUSES.has(jobStatus);
            }
        }

        return result;
    }

    /**
     * Consumes a received result right before its handlers run (#815): one
     * atomic UPDATE that only matches while the result is still pending, so
     * of several attempts at the same event exactly one claims it (Postgres
     * re-checks the condition after a concurrent claim commits). The claim
     * records the attempt's correlation, and then advances a non-terminal job
     * to callback-received.
     *
     * Delivery is at most once from here on: a crash after the claim leaves the
     * event consumed.
     *
     * @param {object} result  From createResult().
     * @returns {Promise<object|null>} The claimed row, or null when another
     *          attempt consumed it first. Rejects when the claim cannot be
     *          written; the result then stays pending.
     */
    async claimResult(result) {
        const status = result.job_id
            ? RESULT_STATUS.CALLBACK_RECEIVED
            : RESULT_STATUS.UNKNOWN_CORRELATION;
        const rows = await this._db(
            `UPDATE external_service_results
             SET status = $2, job_id = $3, correlation_id = $4
             WHERE id = $1 AND status = $5
             RETURNING id, job_id, correlation_id, service_id, hook_name,
                       status, received_at`,
            [result.id, status, result.job_id ?? null, result.correlation_id ?? null,
                RESULT_STATUS.PENDING]
        );
        const claimed = rows[0] || null;

        // Only advance a non-terminal job to callback-received. The event is
        // already consumed, so a failure here is only logged.
        if (claimed && result.job_id && !TERMINAL_JOB_STATUSES.has(result.job_prior_status)) {
            await this._db(
                `UPDATE external_service_jobs
                 SET status = $2, updated_at = now()
                 WHERE id = $1`,
                [result.job_id, JOB_STATUS.CALLBACK_RECEIVED]
            ).catch(error => console.error(
                "[external-services] Could not advance the job of a claimed callback.", error));
        }

        return claimed;
    }

    async updateResult(resultId, {
        status,
        sanitizedPayload = undefined,
        adapterResult    = undefined,
    }) {
        const clauses = ["status = $2", "processed_at = now()"];
        const params  = [resultId, status];

        if (sanitizedPayload !== undefined) {
            params.push(sanitizedPayload);
            clauses.push(`sanitized_payload = $${params.length}`);
        }
        if (adapterResult !== undefined) {
            params.push(adapterResult);
            clauses.push(`adapter_result = $${params.length}`);
        }

        await this._db(
            `UPDATE external_service_results
             SET ${clauses.join(", ")}
             WHERE id = $1`,
            params
        );
    }
}

export const externalServiceJobsService = new ExternalServiceJobsService();

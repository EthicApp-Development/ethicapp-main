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

    async createJob({
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
                 (service_id, hook_name, status,
                  session_id, phase_id, question_id, group_id, user_id,
                  outbound_payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, service_id, hook_name, status,
                       session_id, phase_id, question_id, group_id, user_id,
                       created_at`,
            [
                serviceId, hookName, JOB_STATUS.PENDING,
                sessionId, phaseId, questionId, groupId, userId,
                outboundPayload,
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
        let resultStatus = RESULT_STATUS.UNKNOWN_CORRELATION;

        if (correlationId) {
            const matchRows = await this._db(
                `SELECT id, status, session_id, phase_id, question_id, group_id, user_id
                 FROM external_service_jobs
                 WHERE id::text = $1 AND service_id = $2`,
                [correlationId, serviceId]
            );
            if (matchRows.length > 0) {
                const job    = matchRows[0];
                jobId        = job.id;
                jobStatus    = job.status;
                resultStatus = RESULT_STATUS.CALLBACK_RECEIVED;
                // Propagate job context to result when caller did not provide it.
                sessionId    = sessionId  ?? job.session_id;
                phaseId      = phaseId    ?? job.phase_id;
                questionId   = questionId ?? job.question_id;
                groupId      = groupId    ?? job.group_id;
                userId       = userId     ?? job.user_id;
            }
        }

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
                jobId, correlationId, serviceId, hookName, resultStatus,
                sessionId, phaseId, questionId, groupId, userId,
                rawPayload ?? {}, eventId,
            ]
        );

        // Empty result with a provided eventId means (service_id, event_id) already exists.
        if (rows.length === 0 && eventId !== null) {
            const existing = await this._db(
                `SELECT id, job_id, correlation_id, service_id, hook_name, status, received_at
                 FROM external_service_results
                 WHERE service_id = $1 AND event_id = $2`,
                [serviceId, eventId]
            );
            const dup = existing[0] || null;
            if (dup) {
                dup.is_duplicate = true;
            }
            return dup;
        }

        const result = rows[0] || null;

        if (result && jobStatus !== null) {
            result.job_prior_status = jobStatus;
        }

        // Only advance a non-terminal job to callback-received.
        if (result && jobId && !TERMINAL_JOB_STATUSES.has(jobStatus)) {
            await this._db(
                `UPDATE external_service_jobs
                 SET status = $2, updated_at = now()
                 WHERE id = $1`,
                [jobId, JOB_STATUS.CALLBACK_RECEIVED]
            );
        }

        return result;
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

    async getJob(jobId) {
        const rows = await this._db(
            `SELECT id, service_id, hook_name, status,
                    session_id, phase_id, question_id, group_id, user_id,
                    provider_reference, created_at, updated_at,
                    dispatched_at, completed_at
             FROM external_service_jobs
             WHERE id = $1`,
            [jobId]
        );
        return rows[0] || null;
    }

    async getJobResults(jobId) {
        return this._db(
            `SELECT id, correlation_id, service_id, hook_name, status,
                    session_id, phase_id, question_id, group_id, user_id,
                    adapter_result, received_at, processed_at
             FROM external_service_results
             WHERE job_id = $1
             ORDER BY received_at ASC`,
            [jobId]
        );
    }

    async queryRecentJobs({
        serviceId = null,
        sessionId = null,
        phaseId   = null,
        status    = null,
        from      = null,
        to        = null,
        limit     = 50,
    } = {}) {
        const conditions = [];
        const params     = [];

        if (serviceId != null) {
            params.push(serviceId);
            conditions.push(`service_id = $${params.length}`);
        }
        if (sessionId != null) {
            params.push(sessionId);
            conditions.push(`session_id = $${params.length}`);
        }
        if (phaseId != null) {
            params.push(phaseId);
            conditions.push(`phase_id = $${params.length}`);
        }
        if (status != null) {
            params.push(status);
            conditions.push(`status = $${params.length}`);
        }
        if (from != null) {
            params.push(from);
            conditions.push(`created_at >= $${params.length}`);
        }
        if (to != null) {
            params.push(to);
            conditions.push(`created_at <= $${params.length}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));

        return this._db(
            `SELECT id, service_id, hook_name, status,
                    session_id, phase_id, question_id, group_id, user_id,
                    provider_reference, created_at, updated_at,
                    dispatched_at, completed_at
             FROM external_service_jobs
             ${where}
             ORDER BY created_at DESC
             LIMIT $${params.length}`,
            params
        );
    }

    async queryRecentResults({
        serviceId = null,
        sessionId = null,
        phaseId   = null,
        status    = null,
        from      = null,
        to        = null,
        limit     = 50,
    } = {}) {
        const conditions = [];
        const params     = [];

        if (serviceId != null) {
            params.push(serviceId);
            conditions.push(`service_id = $${params.length}`);
        }
        if (sessionId != null) {
            params.push(sessionId);
            conditions.push(`session_id = $${params.length}`);
        }
        if (phaseId != null) {
            params.push(phaseId);
            conditions.push(`phase_id = $${params.length}`);
        }
        if (status != null) {
            params.push(status);
            conditions.push(`status = $${params.length}`);
        }
        if (from != null) {
            params.push(from);
            conditions.push(`received_at >= $${params.length}`);
        }
        if (to != null) {
            params.push(to);
            conditions.push(`received_at <= $${params.length}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));

        return this._db(
            `SELECT id, job_id, correlation_id, service_id, hook_name, status,
                    session_id, phase_id, question_id, group_id, user_id,
                    received_at, processed_at
             FROM external_service_results
             ${where}
             ORDER BY received_at DESC
             LIMIT $${params.length}`,
            params
        );
    }
}

export const externalServiceJobsService = new ExternalServiceJobsService();

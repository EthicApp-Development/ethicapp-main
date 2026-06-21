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
        sessionId     = null,
        phaseId       = null,
        questionId    = null,
        groupId       = null,
        userId        = null,
    }) {
        let jobId        = null;
        let resultStatus = RESULT_STATUS.UNKNOWN_CORRELATION;

        if (correlationId) {
            const matchRows = await this._db(
                "SELECT id FROM external_service_jobs WHERE id::text = $1",
                [correlationId]
            );
            if (matchRows.length > 0) {
                jobId        = matchRows[0].id;
                resultStatus = RESULT_STATUS.CALLBACK_RECEIVED;
            }
        }

        const rows = await this._db(
            `INSERT INTO external_service_results
                 (job_id, correlation_id, service_id, hook_name, status,
                  session_id, phase_id, question_id, group_id, user_id,
                  raw_payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id, job_id, correlation_id, service_id, hook_name,
                       status, received_at`,
            [
                jobId, correlationId, serviceId, hookName, resultStatus,
                sessionId, phaseId, questionId, groupId, userId,
                rawPayload ?? {},
            ]
        );

        const result = rows[0] || null;

        if (result && jobId) {
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

    async queryRecentJobs({
        serviceId = null,
        sessionId = null,
        phaseId   = null,
        status    = null,
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

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        params.push(Math.min(Number(limit) || 50, 200));

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
        status    = null,
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
        if (status != null) {
            params.push(status);
            conditions.push(`status = $${params.length}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        params.push(Math.min(Number(limit) || 50, 200));

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

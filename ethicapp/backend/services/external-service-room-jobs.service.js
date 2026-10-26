import {
    JOB_KIND,
    JOB_STATUS,
    LIVE_ROOM_JOB_STATUSES,
    poolQuery,
} from "./external-service-jobs.service.js";

/**
 * Room-scoped external service jobs (#833).
 *
 * An adapter that creates a room in an AI service (a Polyadic room per group
 * and phase) opens a room job for it. The job id is the room's correlation id:
 * the adapter sends it when it creates the room, and the service uses it for
 * the room's proactive callbacks. Unlike a hook job, a room job accepts
 * repeated callbacks (each deduplicated by eventId) and is never completed by
 * a callback outcome.
 *
 * Lifecycle (`external_service_jobs.status`, V24):
 *
 *   pending  created, the room is being created; accepts callbacks
 *   open     the room exists; accepts callbacks
 *   closed   the phase ended, the activity finished, or a newer room job of
 *            the same room superseded it; callbacks are refused (409)
 *   failed   the room could not be created; callbacks are refused (409)
 *
 * `room_bound` records whether the service acknowledged the correlation id
 * when the room was created. A callback without a job that names a room with
 * an open bound job is refused (see hasOpenBoundRoomJob()).
 *
 * A room is (service, session, phase, group). Every write is one statement,
 * conditional on the job's current status, so concurrent phase transitions
 * and room re-creations cannot reopen a closed job.
 */
export class ExternalServiceRoomJobsService {
    constructor({ dbQuery } = {}) {
        this._db = dbQuery || poolQuery;
    }

    /**
     * Creates the pending room job of a room. Its id is the room's
     * correlation id. `room` is the provider's room name, kept as the job's
     * provider reference for auditing.
     */
    async createRoomJob({
        serviceId,
        hookName,
        sessionId,
        phaseId,
        groupId,
        questionId = null,
        room       = null,
    }) {
        const rows = await this._db(
            `INSERT INTO external_service_jobs
                 (service_id, hook_name, kind, status,
                  session_id, phase_id, question_id, group_id, provider_reference)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, service_id, hook_name, kind, status,
                       session_id, phase_id, question_id, group_id, created_at`,
            [
                serviceId, hookName, JOB_KIND.ROOM, JOB_STATUS.PENDING,
                sessionId, phaseId, questionId, groupId, room,
            ]
        );
        return rows[0] || null;
    }

    /**
     * Opens a pending room job once its room exists, recording whether the
     * service acknowledged its correlation id (`bound`). In the same statement,
     * every older live room job of the same room is closed: the service now
     * holds this job's id, so the older ones are superseded.
     * @returns {Promise<boolean>} false when the job is no longer pending (a
     *          newer room job superseded it, or its phase already ended).
     */
    async openRoomJob(jobId, { bound = false } = {}) {
        const rows = await this._db(
            `WITH target AS (
                 SELECT id, service_id, session_id, phase_id, group_id, created_at
                 FROM external_service_jobs
                 WHERE id = $1 AND kind = $3 AND status = $4
             ),
             superseded AS (
                 UPDATE external_service_jobs AS older
                 SET status = $5, completed_at = now(), updated_at = now()
                 FROM target
                 WHERE older.kind = $3
                   AND older.id <> target.id
                   AND older.service_id = target.service_id
                   AND older.session_id = target.session_id
                   AND older.phase_id = target.phase_id
                   AND older.group_id = target.group_id
                   AND older.status = ANY($6::text[])
                   AND older.created_at <= target.created_at
                 RETURNING older.id
             )
             UPDATE external_service_jobs AS job
             SET status = $7, room_bound = $2, dispatched_at = now(), updated_at = now()
             FROM target
             WHERE job.id = target.id AND job.status = $4
             RETURNING job.id`,
            [
                jobId, bound === true, JOB_KIND.ROOM, JOB_STATUS.PENDING,
                JOB_STATUS.CLOSED, LIVE_ROOM_JOB_STATUSES, JOB_STATUS.OPEN,
            ]
        );
        return rows.length > 0;
    }

    // The room could not be created: its pending job never opens.
    async failRoomJob(jobId) {
        await this._db(
            `UPDATE external_service_jobs
             SET status = $2, completed_at = now(), updated_at = now()
             WHERE id = $1 AND kind = $3 AND status = $4`,
            [jobId, JOB_STATUS.FAILED, JOB_KIND.ROOM, JOB_STATUS.PENDING]
        );
    }

    /**
     * Closes the live room jobs of a phase, or of every phase of a session
     * when `phaseId` is null.
     * @returns {Promise<number>} How many were closed.
     */
    async closeRoomJobs({ serviceId, sessionId, phaseId = null }) {
        const rows = await this._db(
            `UPDATE external_service_jobs
             SET status = $4, completed_at = now(), updated_at = now()
             WHERE kind = $5
               AND service_id = $1
               AND session_id = $2
               AND ($3::integer IS NULL OR phase_id = $3)
               AND status = ANY($6::text[])
             RETURNING id`,
            [serviceId, sessionId, phaseId, JOB_STATUS.CLOSED, JOB_KIND.ROOM, LIVE_ROOM_JOB_STATUSES]
        );
        return rows.length;
    }

    /**
     * Whether the room a callback without a job names has an open, bound room
     * job: the service acknowledged that room's correlation id, so its
     * callbacks must carry it.
     */
    async hasOpenBoundRoomJob({ serviceId, sessionId, phaseId, groupId }) {
        if ([sessionId, phaseId, groupId].some(id => id === null || id === undefined)) {
            return false;
        }
        const rows = await this._db(
            `SELECT EXISTS (
                 SELECT 1 FROM external_service_jobs
                 WHERE kind = $5
                   AND status = $6
                   AND room_bound
                   AND service_id = $1
                   AND session_id = $2
                   AND phase_id = $3
                   AND group_id = $4
             ) AS bound`,
            [serviceId, sessionId, phaseId, groupId, JOB_KIND.ROOM, JOB_STATUS.OPEN]
        );
        return rows[0]?.bound === true;
    }
}

/**
 * The room jobs of one service, as an adapter receives them in register().
 * Errors propagate; the adapter decides how a failed write degrades.
 */
export function createRoomJobsAccess(store, serviceId) {
    return Object.freeze({
        create: ({ hookName, sessionId, phaseId, groupId, questionId, room }) =>
            store.createRoomJob({ serviceId, hookName, sessionId, phaseId, groupId, questionId, room }),
        open:  (jobId, options) => store.openRoomJob(jobId, options),
        fail:  jobId => store.failRoomJob(jobId),
        close: ({ sessionId, phaseId = null }) =>
            store.closeRoomJobs({ serviceId, sessionId, phaseId }),
    });
}

export const externalServiceRoomJobsService = new ExternalServiceRoomJobsService();

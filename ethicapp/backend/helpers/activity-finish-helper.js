import * as config from "../config/database.config.js";
import { getDBInstance } from "../db/rest-pg-2.js";
import { getStatusCode } from "../../common/modules/session-status.js";
import { studentNotifications } from "../config/socket.config.js";
import { getEnabledExternalServiceIdsBySessionId } from "./designs-helper.js";
import { dispatchPhaseHook as defaultDispatchPhaseHook } from "./external-service-dispatch.js";
import externalServicesRegistry from "../services/external-services.service.js";

/**
 * Finishing an activity (#881): the teacher's own "finish" and the internal
 * endpoint that finishes every open activity of a teacher before the teacher
 * is forgotten (#877) share these steps, in this order:
 *
 * 1. the session becomes `finished` with no current phase, and the phase it
 *    was on is recorded in `activity_finalizations` (V30), in one statement;
 * 2. the cached student activity descriptor is dropped, so students reload a
 *    descriptor without a current phase (#872);
 * 3. `phase-ended` is dispatched for the phase the activity was on, if any;
 * 4. students in the session are told it ended (`onEndSession`);
 * 5. `activity-finished` is dispatched to every service enabled anywhere in the
 *    design, so AI services close their rooms. Its failures are logged, never
 *    thrown;
 * 6. the `activity_finalizations` row is deleted.
 *
 * When step 2, 3 or 4 fails, the row stays. The next finish of that session
 * resumes steps 2 to 6 for the recorded phase, and the session still counts
 * as open for the internal endpoint, so its retry finishes it. A step may run
 * twice, never zero times.
 */

const FINISHED_STATUS = getStatusCode("finished");

// Finishes the session and records its pending finalization with the phase it
// was on, in one statement. With $3, a session already finished is left
// alone. A finalization already pending keeps the phase it recorded, since
// the session has no current phase by then.
export const FINISH_SESSION_SQL = `
    WITH previous AS (
        SELECT id, current_stage
        FROM sessions
        WHERE id = $2
        FOR UPDATE
    ),
    finished AS (
        UPDATE sessions s
        SET status = $1,
            current_stage = NULL
        FROM previous
        WHERE s.id = previous.id
          AND (NOT $3::boolean OR s.status IS DISTINCT FROM $1)
        RETURNING s.id, previous.current_stage
    )
    INSERT INTO activity_finalizations (session_id, ended_phase_id)
    SELECT id, current_stage
    FROM finished
    ON CONFLICT (session_id) DO NOTHING
`;

export const PENDING_FINALIZATION_SQL = `
    SELECT ended_phase_id
    FROM activity_finalizations
    WHERE session_id = $1
`;

export const SESSION_EXISTS_SQL = `
    SELECT 1
    FROM sessions
    WHERE id = $1
`;

export const COMPLETE_FINALIZATION_SQL = `
    DELETE FROM activity_finalizations
    WHERE session_id = $1
`;

// Every session the user created that is not finished, initiated ones
// included, and every one whose finishing did not complete. `status` is
// nullable, hence IS DISTINCT FROM.
export const OPEN_SESSIONS_OF_CREATOR_SQL = `
    SELECT s.id
    FROM sessions s
    WHERE s.creator = $1
      AND (
          s.status IS DISTINCT FROM $2
          OR EXISTS (
              SELECT 1
              FROM activity_finalizations f
              WHERE f.session_id = s.id
          )
      )
    ORDER BY s.id
`;

async function defaultQuery(sql, params) {
    const db = await getDBInstance(config.dbconnString);
    return db.query(sql, params);
}

// Loaded on first use: the descriptor cache module opens a Redis connection
// when it is imported, which tests and scripts importing this module avoid.
async function defaultInvalidateStudentDescriptor(sessionId) {
    const descriptorCache = await import("./student-activity-state-helper.js");
    await descriptorCache.invalidateCachedStudentActivityDescriptor(sessionId);
}

function defaultNotifyStudentsEnded(sessionId) {
    studentNotifications.endSession(sessionId);
}

function defaultDispatchRegistryHook(hookName, context, options) {
    return externalServicesRegistry.dispatchHook(hookName, context, options);
}

function errorSummary(error) {
    return [error?.name, error?.message].filter(Boolean).join(": ") || "unknown error";
}

/**
 * @param {Object} [dependencies]
 * @param {(sql: string, params: Array) => Promise<{ rows: Array, rowCount: number }>}
 *        [dependencies.query]
 * @param {(sessionId: number|string) => Promise<void>} [dependencies.invalidateStudentDescriptor]
 * @param {(hookName: string, context: Object) => Promise<unknown>} [dependencies.dispatchPhaseHook]
 * @param {(sessionId: number|string) => void} [dependencies.notifyStudentsEnded]
 * @param {(sessionId: number) => Promise<string[]>} [dependencies.readEnabledServiceIds]
 *        Services enabled anywhere in the session's design.
 * @param {(hookName: string, context: Object, options: Object) => Promise<unknown>}
 *        [dependencies.dispatchRegistryHook]
 * @param {{ error: Function }} [dependencies.logger]
 */
export function createActivityFinisher({
    query = defaultQuery,
    invalidateStudentDescriptor = defaultInvalidateStudentDescriptor,
    dispatchPhaseHook = defaultDispatchPhaseHook,
    notifyStudentsEnded = defaultNotifyStudentsEnded,
    readEnabledServiceIds = getEnabledExternalServiceIdsBySessionId,
    dispatchRegistryHook = defaultDispatchRegistryHook,
    logger = console,
} = {}) {
    // The registry receives activity-finished even when no service is enabled
    // or the design cannot be read, since it also closes the session's room
    // jobs (#833).
    async function dispatchActivityFinished(sessionId, context) {
        try {
            let enabledServiceIds = [];
            try {
                enabledServiceIds = await readEnabledServiceIds(sessionId);
            } catch (error) {
                logger.error("[external-services] Could not read the services of the finished "
                    + "activity; activity-finished only closes its room jobs.", error);
            }
            await dispatchRegistryHook("activity-finished", context, { enabledServiceIds });
        } catch (error) {
            logger.error("[external-services] Error dispatching activity-finished hook.", error);
        }
    }

    /**
     * Finishes one activity, or resumes the finishing of one that did not
     * complete. Errors other than the activity-finished dispatch propagate;
     * the session is then finished, and its finishing pending.
     *
     * @param {number|string} sessionId
     * @param {{ onlyIfOpen?: boolean }} [options] With `onlyIfOpen`, a session
     *        that is already finished, with nothing pending, is left alone and
     *        reported as `not_updated`.
     * @returns {Promise<{ status: "finished", sessionId: number, previousPhaseId: number|null }
     *          | { status: "not_found" | "not_updated", sessionId: number }>}
     */
    async function finishActivity(sessionId, { onlyIfOpen = false } = {}) {
        const numericSessionId = Number(sessionId);
        await query(FINISH_SESSION_SQL, [FINISHED_STATUS, sessionId, onlyIfOpen]);
        const pending = await query(PENDING_FINALIZATION_SQL, [sessionId]);

        if (!pending.rows?.length) {
            const session = await query(SESSION_EXISTS_SQL, [sessionId]);
            return {
                status:    session.rows?.length ? "not_updated" : "not_found",
                sessionId: numericSessionId,
            };
        }

        const previousPhaseId = Number(pending.rows[0].ended_phase_id) || null;

        await invalidateStudentDescriptor(sessionId);

        if (previousPhaseId) {
            await dispatchPhaseHook("phase-ended", {
                sessionId:      numericSessionId,
                phaseId:        previousPhaseId,
                startedPhaseId: null,
                endedPhaseId:   previousPhaseId,
            });
        }

        notifyStudentsEnded(sessionId);

        await dispatchActivityFinished(numericSessionId, {
            sessionId:      numericSessionId,
            phaseId:        previousPhaseId,
            startedPhaseId: null,
            endedPhaseId:   previousPhaseId,
        });

        await query(COMPLETE_FINALIZATION_SQL, [sessionId]);

        return { status: "finished", sessionId: numericSessionId, previousPhaseId };
    }

    /**
     * @param {number} creatorId
     * @returns {Promise<number[]>} The ids of the creator's unfinished sessions,
     *          and of those whose finishing did not complete, in ascending order.
     */
    async function listOpenActivityIds(creatorId) {
        const result = await query(OPEN_SESSIONS_OF_CREATOR_SQL, [creatorId, FINISHED_STATUS]);
        return (result.rows || []).map(row => Number(row.id));
    }

    /**
     * Finishes every unfinished session the creator has, one at a time, and
     * resumes those whose finishing did not complete. A failure is recorded
     * and the next session is still finished. A second call retries the
     * failed ones, and finds nothing left once all succeed.
     *
     * @param {number} creatorId
     * @returns {Promise<{ finished: number[], skipped: number[],
     *          failed: { sessionId: number, error: string }[] }>} `skipped` holds
     *          sessions finished or deleted between the listing and the update.
     */
    async function finishOpenActivitiesOf(creatorId) {
        const sessionIds = await listOpenActivityIds(creatorId);
        const finished = [];
        const skipped = [];
        const failed = [];

        for (const sessionId of sessionIds) {
            try {
                const result = await finishActivity(sessionId, { onlyIfOpen: true });
                (result.status === "finished" ? finished : skipped).push(sessionId);
            } catch (error) {
                logger.error(`[activity-finish] Could not finish session ${sessionId} `
                    + `of user ${creatorId}: ${errorSummary(error)}`);
                failed.push({ sessionId, error: "finish_failed" });
            }
        }

        return { finished, skipped, failed };
    }

    return { finishActivity, listOpenActivityIds, finishOpenActivitiesOf };
}

const defaultActivityFinisher = createActivityFinisher();

export default defaultActivityFinisher;

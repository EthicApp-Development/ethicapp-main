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
 * 1. the session becomes `finished` with no current phase;
 * 2. the cached student activity descriptor is dropped, so students reload a
 *    descriptor without a current phase (#872);
 * 3. `phase-ended` is dispatched for the phase the activity was on, if any;
 * 4. students in the session are told it ended (`onEndSession`);
 * 5. `activity-finished` is dispatched to every service enabled anywhere in the
 *    design, so AI services close their rooms. Its failures are logged, never
 *    thrown.
 */

const FINISHED_STATUS = getStatusCode("finished");

export const SESSION_CURRENT_PHASE_SQL = `
    SELECT current_stage
    FROM sessions
    WHERE id = $1
`;

export const FINISH_SESSION_SQL = `
    UPDATE sessions
    SET status = $1,
        current_stage = NULL
    WHERE id = $2
`;

// The same update, applied only while the session is still open, so a session
// finished meanwhile (by its teacher, or by a concurrent call) is not finished
// twice.
export const FINISH_OPEN_SESSION_SQL = `
    UPDATE sessions
    SET status = $1,
        current_stage = NULL
    WHERE id = $2
      AND status IS DISTINCT FROM $1
`;

// Every session the user created that is not finished, initiated ones
// included. `status` is nullable, hence IS DISTINCT FROM.
export const OPEN_SESSIONS_OF_CREATOR_SQL = `
    SELECT id
    FROM sessions
    WHERE creator = $1
      AND status IS DISTINCT FROM $2
    ORDER BY id
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
     * Finishes one activity. Errors other than the activity-finished dispatch
     * propagate; the session may then already be finished.
     *
     * @param {number|string} sessionId
     * @param {{ onlyIfOpen?: boolean }} [options] With `onlyIfOpen`, a session
     *        that is already finished is left alone and reported as `not_updated`.
     * @returns {Promise<{ status: "finished", sessionId: number, previousPhaseId: number|null }
     *          | { status: "not_found" | "not_updated", sessionId: number }>}
     */
    async function finishActivity(sessionId, { onlyIfOpen = false } = {}) {
        const numericSessionId = Number(sessionId);
        const current = await query(SESSION_CURRENT_PHASE_SQL, [sessionId]);

        if (!current.rows?.length) {
            return { status: "not_found", sessionId: numericSessionId };
        }

        const previousPhaseId = Number(current.rows[0].current_stage) || null;
        const update = await query(
            onlyIfOpen ? FINISH_OPEN_SESSION_SQL : FINISH_SESSION_SQL,
            [FINISHED_STATUS, sessionId],
        );

        if (update.rowCount === 0) {
            return { status: "not_updated", sessionId: numericSessionId };
        }

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

        return { status: "finished", sessionId: numericSessionId, previousPhaseId };
    }

    /**
     * @param {number} creatorId
     * @returns {Promise<number[]>} The ids of the creator's unfinished sessions,
     *          in ascending order.
     */
    async function listOpenActivityIds(creatorId) {
        const result = await query(OPEN_SESSIONS_OF_CREATOR_SQL, [creatorId, FINISHED_STATUS]);
        return (result.rows || []).map(row => Number(row.id));
    }

    /**
     * Finishes every unfinished session the creator has, one at a time. A
     * failure is recorded and the next session is still finished. A second
     * call finds nothing left to finish.
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

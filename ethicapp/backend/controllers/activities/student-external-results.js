import express from "express";
import { requireRole } from "../../helpers/auth-helper.js";
import { requireSessionOwnerOrParticipant } from "../../helpers/activity-owner-helper.js";
import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import defaultRegistry from "../../services/external-services.service.js";
import { errorClassification } from "../../services/external-service-handler-run.js";

// $1 session id. The phases a student of the session sees as tabs: full_state
// lists every stages row of the session, and a row exists once its phase has
// started (#906).
export const SESSION_PHASE_IDS_SQL = `
    SELECT st.id
    FROM stages AS st
    WHERE st.sesid = $1
`;

async function loadSessionPhaseIds(sessionId) {
    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       SESSION_PHASE_IDS_SQL,
        sqlParams: [rpg2.param("plain", sessionId)],
    });
    return rows.map(row => Number(row.id));
}

/**
 * The results whose phase is one of `phaseIds`, in their order. The hook
 * already drops an entry without a positive integer `phaseId`; this also
 * drops one whose phase is not a phase of the session, which an adapter can
 * name for a stored result that has no phase of its own, or which a phase
 * replaced by a failed start leaves behind.
 *
 * @param {ReadonlyArray<{ phaseId: number }>} results
 * @param {Iterable<number>} phaseIds
 * @returns {Array<Object>}
 */
export function resultsOfPhases(results, phaseIds) {
    const visible = new Set(phaseIds);
    return results.filter(result => visible.has(result.phaseId));
}

/**
 * @param {Object} [dependencies]
 * @param {{ collectStudentResults: Function }} [dependencies.registry] - The
 *     external services registry.
 * @param {(sessionId: number) => Promise<number[]>} [dependencies.loadPhaseIds]
 *     - The ids of the session's phases.
 */
export function createStudentExternalResultsRouter({
    registry = defaultRegistry,
    loadPhaseIds = loadSessionPhaseIds,
} = {}) {
    const router = express.Router();

    /**
     * @route GET /activities/:id/users/:user_id/external_service_results
     * @description The results external services published to a student in
     *   an activity (epic #1123, #1127), rebuilt by their adapters from the
     *   stored callbacks through the `student-results-reading` hook, for
     *   every phase of the session the student sees. It is read on every
     *   request: results arrive while the student works, so nothing is
     *   cached, and the response says `Cache-Control: no-store`.
     *
     *   It refuses the requests that full_state refuses, in the same way: a
     *   role other than A with 403 before any lookup, and with the 404 of an
     *   unknown session another student's id, a session the student is not
     *   enrolled in, an anonymized account and an unknown session (#926).
     * @returns 200 `{ results: [{ serviceId, resultId, phaseId, questionId,
     *   component, payload, message, status, publishedAt }] }`, oldest
     *   `publishedAt` first; 400 for ids that are not numbers; 401 without a
     *   session; 403 for another role; 404 as above; 500 when the session's
     *   services or phases cannot be read.
     */
    router.get("/activities/:id/users/:user_id/external_service_results", async (req, res) => {
        res.set("Cache-Control", "no-store");

        const sessionId = Number(req.params.id);
        const userId = Number(req.params.user_id);

        // Only students call this endpoint: a wrong role is refused before
        // any lookup.
        if (!requireRole(req, res, "A")) {
            return;
        }

        if (!sessionId || !userId) {
            return res.status(400).json({ error: "Invalid session ID or user ID." });
        }

        try {
            // As in full_state: only a student enrolled in the session, asking
            // for their own results, reads them (#926).
            const access = await requireSessionOwnerOrParticipant(req, res, sessionId, {
                subjectUserId: userId,
            });
            if (!access) {
                return;
            }

            const results = await registry.collectStudentResults({
                sessionId: access.sessionId,
                userId,
            });
            const visible = results.length > 0
                ? resultsOfPhases(results, await loadPhaseIds(access.sessionId))
                : [];

            if (visible.length < results.length) {
                console.warn(
                    "[external-services] Left out student results of phases outside the session.",
                    JSON.stringify({
                        sessionId: access.sessionId,
                        userId,
                        dropped:   results.length - visible.length,
                    })
                );
            }

            return res.status(200).json({ results: visible });
        } catch (error) {
            // Ids and the error's classification only: an adapter's error or
            // a stored payload can quote the student.
            console.error(
                "[external-services] Could not read a student's results.",
                JSON.stringify({ sessionId, userId, ...errorClassification(error) })
            );
            return res.status(500).json({ error: "Internal server error." });
        }
    });

    return router;
}

export default createStudentExternalResultsRouter();

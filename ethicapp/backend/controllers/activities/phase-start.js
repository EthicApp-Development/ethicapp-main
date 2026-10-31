"use strict";

import express from "express";
import { requireRole } from "../../helpers/auth-helper.js";
import { requireSessionOwner } from "../../helpers/activity-owner-helper.js";
import defaultPhaseStarter from "../../helpers/phase-start-helper.js";

const DENIED = "Access denied. User is not authorized for this activity.";

// The status and body of each outcome other than "started"
// (helpers/phase-start-helper.js).
function refusal(result) {
    switch (result.status) {
    case "forbidden":
        return [403, { error: DENIED }];
    case "not_found":
        return [404, { error: "Session not found." }];
    case "not_launched":
        return [404, { error: "The session has no activity.", code: "ACTIVITY_NOT_FOUND" }];
    case "finished":
        return [409, { error: "The activity is finished.", code: "ACTIVITY_FINISHED" }];
    case "stale":
        return [409, {
            error:              "The activity is no longer at the expected phase.",
            code:               "PHASE_CHANGED",
            currentPhaseNumber: result.currentPhaseNumber,
        }];
    case "no_next_phase":
        return [409, {
            error:              "The design has no phase after the current one.",
            code:               "NO_NEXT_PHASE",
            currentPhaseNumber: result.currentPhaseNumber,
        }];
    case "invalid_design":
        return [422, { error: result.problem, code: "INVALID_PHASE_DESIGN" }];
    default:
        throw new Error(`Unknown phase start outcome: ${result.status}`);
    }
}

function expectedPhaseNumberOf(body) {
    const value = body?.expectedPhaseNumber;
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * @param {Object} [dependencies]
 * @param {{ startNextPhase: Function }} [dependencies.phaseStarter]
 */
export function createPhaseStartRouter({ phaseStarter = defaultPhaseStarter } = {}) {
    const router = express.Router();

    /**
     * @route POST /activities/:session_id/phases/next
     * @description Starts the activity's next phase (#906), its first one
     *   included: the phase, its items and, for a team phase, its groups are
     *   created from the stored design, and the activity moves to it, in one
     *   transaction. Only the activity's teacher may do it.
     * @body {{ expectedPhaseNumber: number }} The number of the phase the
     *   teacher sees as current, 0 before the first phase. Any other field,
     *   such as the phase's settings, is ignored.
     * @returns 201 `{ status: "ok", phase: { id, number } }`; 409 with `code`
     *   PHASE_CHANGED (and `currentPhaseNumber`) when the activity is no longer
     *   at that phase, ACTIVITY_FINISHED or NO_NEXT_PHASE; 422
     *   INVALID_PHASE_DESIGN when the design's phase cannot be started.
     */
    router.post("/activities/:session_id/phases/next", async (req, res) => {
        if (!requireRole(req, res, "P")) {
            return;
        }

        const expectedPhaseNumber = expectedPhaseNumberOf(req.body);
        if (expectedPhaseNumber === null) {
            return res.status(400).json({
                error: "expectedPhaseNumber must be a non-negative integer.",
            });
        }

        try {
            const owner = await requireSessionOwner(req, res, req.params.session_id);
            if (!owner) {
                return;
            }

            const result = await phaseStarter.startNextPhase({
                sessionId: owner.sessionId,
                teacherId: req.session.uid,
                expectedPhaseNumber,
            });

            if (result.status === "started") {
                return res.status(201).json({ status: "ok", phase: result.phase });
            }

            const [status, body] = refusal(result);
            return res.status(status).json(body);
        } catch (error) {
            console.error("Error starting the next phase:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    return router;
}

export default createPhaseStartRouter();

import express from "express";
import { requireSessionOwnerOrParticipant } from "../../helpers/activity-owner-helper.js";
import { readPhaseClock } from "../../helpers/phase-clock.js";

/**
 * @param {Object} [dependencies]
 * @param {(sessionId: number) => Promise<Object|null>} [dependencies.readClock]
 */
export function createPhaseClockRouter({ readClock = readPhaseClock } = {}) {
    const router = express.Router();

    /**
     * @route GET /activities/:session_id/clock
     * @description The phase clock of an activity (epic #1105, #1111), for
     *   the teacher's dashboard and the student app, which count the current
     *   phase down from it. It is read from the database on every request and
     *   never cached: the response says `Cache-Control: no-store`, and the
     *   clock stays out of the cached student descriptor.
     *
     *   The activity's owner (role P, or an administrator impersonating them)
     *   and its participants (role A, enrolled in the session) may read it,
     *   with the rule of requireSessionOwnerOrParticipant.
     * @returns 200 `{ sessionId, timeMode, finished, phaseId, phaseNumber,
     *   startedAt, endsAt, isLastPhase, serverNow }`, as helpers/phase-clock.js
     *   documents it, with its edge cases; 401 without a session; 403 for a
     *   role other than P or A; 404 `{ error: "Session not found." }` for an
     *   unknown session, another teacher's activity, a student not enrolled
     *   in it and an anonymized account, so the answer does not reveal that
     *   the activity exists (#923); 500 when the clock cannot be read.
     */
    router.get("/activities/:session_id/clock", async (req, res) => {
        res.set("Cache-Control", "no-store");

        try {
            const access = await requireSessionOwnerOrParticipant(req, res,
                req.params.session_id);
            if (!access) {
                return;
            }

            const clock = await readClock(access.sessionId);
            if (!clock) {
                return res.status(404).json({ error: "Session not found." });
            }
            return res.status(200).json(clock);
        } catch (error) {
            console.error("Error reading the phase clock:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    return router;
}

export default createPhaseClockRouter();

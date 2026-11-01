import express from "express";
import { requireSessionOwner } from "../../helpers/activity-owner-helper.js";
import defaultPseudonymAssigner from "../../helpers/participant-pseudonyms-helper.js";

/**
 * @param {Object} [dependencies]
 * @param {{ assignParticipantPseudonyms: Function }} [dependencies.pseudonymAssigner]
 */
export function createParticipantPseudonymsRouter({
    pseudonymAssigner = defaultPseudonymAssigner,
} = {}) {
    const router = express.Router();

    /**
     * @route GET /sessions/:id/pseudonyms
     * @description The pseudonym numbers of the activity's students (#897),
     *   which the dashboard shows in place of their names while the teacher
     *   hides them. A student without a number gets one now, so a student who
     *   joined late has one the next time the dashboard asks. Asking again
     *   changes no number already assigned.
     *
     *   Only the activity's owner may read them (or an administrator
     *   impersonating them); students never receive them. It is a separate
     *   endpoint so that GET /sessions/:id/users keeps its response and does
     *   not write.
     * @returns 200 `{ pseudonyms: [{ userId, number }] }`, ordered by number;
     *   401 without a session, 403 for a student or a teacher who does not
     *   own the activity, 404 for an unknown session.
     */
    router.get("/sessions/:id/pseudonyms", async (req, res) => {
        try {
            const owner = await requireSessionOwner(req, res, req.params.id);
            if (!owner) {
                return;
            }

            const pseudonyms = await pseudonymAssigner.assignParticipantPseudonyms(owner.sessionId);
            return res.status(200).json({ pseudonyms });
        } catch (error) {
            console.error("Error reading the participants' pseudonyms:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    return router;
}

export default createParticipantPseudonymsRouter();

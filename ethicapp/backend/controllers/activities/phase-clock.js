import express from "express";
import { requireRole } from "../../helpers/auth-helper.js";
import {
    requireSessionOwner,
    requireSessionOwnerOrParticipant,
} from "../../helpers/activity-owner-helper.js";
import { readPhaseClock } from "../../helpers/phase-clock.js";
import {
    EXTENSION_MINUTES,
    extendPhaseDeadline,
} from "../../helpers/phase-clock-extension.js";
import defaultPhaseClockNotifier from "../../helpers/phase-clock-notifier.js";

const SESSION_NOT_FOUND = Object.freeze({ error: "Session not found." });
const PHASE_NOT_FOUND = Object.freeze({ error: "Phase not found." });

// An ISO 8601 date and time with a UTC offset, as the clock's times are
// written (helpers/phase-clock.js), with up to microseconds.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function expectedEndsAtOf(body) {
    const value = body?.expectedEndsAt;
    if (typeof value !== "string" || !ISO_DATE_TIME.test(value)) {
        return null;
    }
    return Number.isNaN(Date.parse(value)) ? null : value;
}

function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// The status and body of each refusal of helpers/phase-clock-extension.js
// other than the 404s. Each 409 carries the clock as it is now, so the
// dashboard can show it without another request.
const EXTENSION_CONFLICTS = Object.freeze({
    finished: {
        error: "The activity is finished.",
        code:  "ACTIVITY_FINISHED",
    },
    not_current: {
        error: "The phase is not the activity's current phase.",
        code:  "PHASE_NOT_CURRENT",
    },
    no_deadline: {
        error: "The phase has no deadline.",
        code:  "NO_DEADLINE",
    },
    deadline_passed: {
        error: "The phase's deadline has passed and the activity is moving on.",
        code:  "DEADLINE_PASSED",
    },
    deadline_changed: {
        error: "The phase's deadline is no longer the expected one.",
        code:  "DEADLINE_CHANGED",
    },
});

/**
 * @param {Object} [dependencies]
 * @param {(sessionId: number) => Promise<Object|null>} [dependencies.readClock]
 * @param {(request: Object) => Promise<{ status: string }>} [dependencies.extendDeadline]
 *        helpers/phase-clock-extension.js
 * @param {(sessionId: number) => Promise<void>} [dependencies.notifyClockChanged]
 *        Sends the new clock to the students and the teacher
 *        (helpers/phase-clock-notifier.js); it never throws.
 */
export function createPhaseClockRouter({
    readClock = readPhaseClock,
    extendDeadline = extendPhaseDeadline,
    notifyClockChanged = sessionId => defaultPhaseClockNotifier.clockChanged(sessionId),
} = {}) {
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

    /**
     * @route POST /activities/:session_id/phases/:phase_id/clock/extend
     * @description "+1 min" (epic #1105, #1112): adds one minute to the
     *   deadline of phase `phase_id` (a `stages` id, the clock's `phaseId`),
     *   in soft and hard mode, when it is still the deadline the teacher saw.
     *   A double click, or two dashboards of the same activity, add one minute
     *   between them. Only the activity's owner may do it (role P, or an
     *   administrator impersonating them). After a change the students and
     *   the teacher get the new clock (`onPhaseClock`).
     *
     *   The minute is added to the later of the deadline and the
     *   database's now() (decision of 2026-11-11): before the deadline it
     *   moves the deadline one minute later; once the deadline has passed,
     *   in soft mode or on a hard-mode last phase whose deadline the runner
     *   (#1113) handled, the new deadline is one minute from now, and the
     *   runner handles it again once it passes. In hard mode a deadline that
     *   passed and that the runner did not handle yet is not extended.
     * @body {{ minutes: 1, expectedEndsAt: string }} `minutes` must be 1;
     *   `expectedEndsAt` is the clock's `endsAt` as the teacher saw it, an
     *   ISO 8601 time compared to the millisecond.
     * @returns 200 with the new clock, as GET /activities/:id/clock answers
     *   it; 400 `{ error, code: "INVALID_MINUTES" }` or
     *   `{ error, code: "INVALID_EXPECTED_ENDS_AT" }`; 401 without a session;
     *   403 for a role other than P; 404 `{ error: "Session not found." }`
     *   for an unknown session and another teacher's activity (#923); 404
     *   `{ error: "Phase not found." }` for a phase that is not one of the
     *   activity's; 409 `{ error, code, clock }`, with the clock as it is
     *   now, and `code` ACTIVITY_FINISHED, PHASE_NOT_CURRENT, NO_DEADLINE (an
     *   activity without a time mode or a phase without a duration),
     *   DEADLINE_PASSED (a hard-mode deadline that passed and is not handled
     *   yet) or DEADLINE_CHANGED (the deadline is no longer `expectedEndsAt`);
     *   500 on a failure.
     */
    router.post("/activities/:session_id/phases/:phase_id/clock/extend", async (req, res) => {
        res.set("Cache-Control", "no-store");

        if (!requireRole(req, res, "P")) {
            return;
        }

        if (req.body?.minutes !== EXTENSION_MINUTES) {
            return res.status(400).json({
                error: `minutes must be ${EXTENSION_MINUTES}.`,
                code:  "INVALID_MINUTES",
            });
        }
        const expectedEndsAt = expectedEndsAtOf(req.body);
        if (expectedEndsAt === null) {
            return res.status(400).json({
                error: "expectedEndsAt must be an ISO 8601 date and time.",
                code:  "INVALID_EXPECTED_ENDS_AT",
            });
        }

        try {
            const owner = await requireSessionOwner(req, res, req.params.session_id);
            if (!owner) {
                return;
            }
            const phaseId = positiveInteger(req.params.phase_id);
            if (phaseId === null) {
                return res.status(404).json(PHASE_NOT_FOUND);
            }

            const result = await extendDeadline({
                sessionId: owner.sessionId,
                phaseId,
                teacherId: req.session.uid,
                minutes:   EXTENSION_MINUTES,
                expectedEndsAt,
            });

            if (result.status === "not_found") {
                return res.status(404).json(SESSION_NOT_FOUND);
            }
            if (result.status === "phase_not_found") {
                return res.status(404).json(PHASE_NOT_FOUND);
            }

            const conflict = EXTENSION_CONFLICTS[result.status];
            if (!conflict && result.status !== "extended") {
                throw new Error(`Unknown extension outcome: ${result.status}`);
            }

            const clock = await readClock(owner.sessionId);
            if (conflict) {
                return res.status(409).json({ ...conflict, clock });
            }

            await notifyClockChanged(owner.sessionId);
            if (!clock) {
                return res.status(404).json(SESSION_NOT_FOUND);
            }
            return res.status(200).json(clock);
        } catch (error) {
            console.error("Error extending the phase's deadline:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
    });

    return router;
}

export default createPhaseClockRouter();

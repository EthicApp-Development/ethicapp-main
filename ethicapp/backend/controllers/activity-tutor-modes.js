import express from "express";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { requireRole } from "../helpers/auth-helper.js";
import { listSessionTutorModes } from "../helpers/tutor-mode-records.js";

/**
 * The modes of an activity's tutor sessions, for its teacher (#865):
 * `GET /activities/:session_id/tutor-modes`. Only the session's creator can
 * read them: students get 403 from requireRole and other teachers 404. The
 * activity view reads them again when the registry announces a new
 * instantiation (`onExternalServiceInstantiated` on the teacher socket).
 */

function parseSessionId(value) {
    const sessionId = Number(value);
    return Number.isSafeInteger(sessionId) && sessionId > 0 ? sessionId : null;
}

async function ownsSession(sessionId, userId) {
    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       "SELECT 1 FROM sessions WHERE id = $1 AND creator = $2;",
        sqlParams: [sessionId, userId],
    });
    return rows.length > 0;
}

const defaultDependencies = {
    ownsSession,
    listTutorModes: listSessionTutorModes,
};

/**
 * @returns {Promise<{status: number, body: Object}>} `200 { status: "ok",
 *     result: { sessionId, questions } }`, where `questions` are the records
 *     of helpers/tutor-mode-records.js; `404 SESSION_NOT_FOUND` for a session
 *     the teacher did not create.
 */
export async function listActivityTutorModesForOwner({
    sessionId,
    userId,
    dependencies = defaultDependencies,
}) {
    if (!await dependencies.ownsSession(sessionId, userId)) {
        return {
            status: 404,
            body:   { status: "err", message: "Activity not found.", code: "SESSION_NOT_FOUND" },
        };
    }

    const questions = await dependencies.listTutorModes(sessionId);
    return { status: 200, body: { status: "ok", result: { sessionId, questions } } };
}

// `dependencies` replaces the database access in tests.
export function createActivityTutorModesRouter(dependencies = defaultDependencies) {
    const router = express.Router();

    router.get("/activities/:session_id/tutor-modes", async (req, res) => {
        if (!requireRole(req, res, "P")) {
            return;
        }

        const sessionId = parseSessionId(req.params.session_id);
        if (!sessionId) {
            return res.status(400).json({ status: "err", message: "Invalid activity id." });
        }

        try {
            const { status, body } = await listActivityTutorModesForOwner({
                sessionId,
                userId: req.session.uid,
                dependencies,
            });
            return res.status(status).json(body);
        } catch (error) {
            console.error("Failed to load the tutor modes:", error);
            return res.status(500)
                .json({ status: "err", message: "Failed to load the tutor modes." });
        }
    });

    return router;
}

export default createActivityTutorModesRouter();

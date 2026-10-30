import express from "express";

import * as config from "../../config/database.config.js";
import { getDBInstance } from "../../db/rest-pg-2.js";
import { requireSuperAdminJson } from "../../helpers/auth-helper.js";
import defaultActivityFinisher from "../../helpers/activity-finish-helper.js";

/**
 * Internal endpoints that finish a teacher's open activities before the
 * teacher is forgotten (#881, used by #877).
 *
 * Like the impersonation start and the AI services endpoints, the management
 * console calls them over the internal network only (NGINX answers 404 for
 * `/api/admin/` at the edge), forwarding the operator's session, which must
 * have role `S`.
 *
 * - `GET /api/admin/users/:id/open-activities` answers
 *   `{ ok: true, userId, count, sessionIds }`: the sessions the teacher created
 *   that are not finished, initiated ones included.
 * - `POST /api/admin/users/:id/finish-activities` finishes them one at a time,
 *   exactly as the teacher's own "finish" does, and answers
 *   `{ ok, userId, finished, skipped, failed }`. `ok` is false when a session
 *   could not be finished; `failed` lists `{ sessionId, error }`. `skipped`
 *   holds sessions finished elsewhere meanwhile. A second call finds nothing
 *   left to finish.
 *
 * Refusals: 400 `invalid_user` (the id is not a positive integer) or
 * `not_a_teacher`, 404 `user_not_found`, 500 `internal_error`.
 */

export const USER_ROLE_SQL = `
    SELECT id, role
    FROM users
    WHERE id = $1
    LIMIT 1
`;

async function defaultReadUser(userId) {
    const db = await getDBInstance(config.dbconnString);
    const result = await db.query(USER_ROLE_SQL, [userId]);
    return result.rows[0] || null;
}

function parseUserId(value) {
    if (!/^[1-9][0-9]{0,9}$/.test(value)) {
        return null;
    }
    const userId = Number(value);
    return userId <= 2147483647 ? userId : null;
}

// Resolves the target teacher, or answers the refusal and returns null.
async function resolveTeacher(req, res, readUser) {
    const userId = parseUserId(req.params.id);
    if (!userId) {
        res.status(400).json({ ok: false, error: "invalid_user" });
        return null;
    }

    const user = await readUser(userId);
    if (!user) {
        res.status(404).json({ ok: false, error: "user_not_found" });
        return null;
    }
    if (user.role !== "P") {
        res.status(400).json({ ok: false, error: "not_a_teacher" });
        return null;
    }
    return userId;
}

// Logs the failure without its message, which may carry connection details.
function sendInternalError(res, route, error) {
    const details = [error?.name, error?.code].filter(Boolean).join(" ");
    console.error(`[admin-teacher-activities] ${route} failed${details ? `: ${details}` : ""}`);
    return res.status(500).json({ ok: false, error: "internal_error" });
}

/**
 * @param {object} [options]
 * @param {{ listOpenActivityIds: Function, finishOpenActivitiesOf: Function }} [options.finisher]
 * @param {(userId: number) => Promise<{ id: number, role: string }|null>} [options.readUser]
 */
export function createTeacherActivitiesAdminRouter({
    finisher = defaultActivityFinisher,
    readUser = defaultReadUser,
} = {}) {
    // Case-sensitive like NGINX's locations: `/API/admin/...` must not reach
    // these handlers through the edge's general proxy.
    const router = express.Router({ caseSensitive: true });

    async function countOpenActivities(req, res) {
        try {
            const userId = await resolveTeacher(req, res, readUser);
            if (!userId) {
                return undefined;
            }

            const sessionIds = await finisher.listOpenActivityIds(userId);
            return res.status(200).json({ ok: true, userId, count: sessionIds.length, sessionIds });
        } catch (error) {
            return sendInternalError(res, "open activities", error);
        }
    }

    async function finishOpenActivities(req, res) {
        try {
            const userId = await resolveTeacher(req, res, readUser);
            if (!userId) {
                return undefined;
            }

            const { finished, skipped, failed } = await finisher.finishOpenActivitiesOf(userId);
            return res.status(200).json({
                ok: failed.length === 0,
                userId,
                finished,
                skipped,
                failed,
            });
        } catch (error) {
            return sendInternalError(res, "finish activities", error);
        }
    }

    const userPath = "/api/admin/users/:id";
    router.get(`${userPath}/open-activities`, requireSuperAdminJson, countOpenActivities);
    router.post(`${userPath}/finish-activities`, requireSuperAdminJson, finishOpenActivities);

    return router;
}

export default createTeacherActivitiesAdminRouter();

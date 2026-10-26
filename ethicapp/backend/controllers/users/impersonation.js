import express from "express";
import pass from "../../helpers/compat-helper.js";
import { getDBInstance } from "../../db/rest-pg-2.js";
import { isSuperAdminSession as isAuthorizedSuperAdmin } from "../../helpers/auth-helper.js";
import {
    legacySessionCookieName,
    legacySessionCookieOptions,
} from "../../config/session.config.js";

const router = express.Router();

const MANAGEMENT_CONSOLE_USERS_PATH = "/mng/users";

// Browsers send Origin on form posts; reject one from another host. Requests
// without Origin (same-origin navigations in older browsers, server callers)
// are let through: the session cookie is SameSite=Lax, so a cross-site form
// post carries no session anyway.
function isSameOriginRequest(req) {
    const origin = req.get("Origin");
    if (!origin) {
        return true;
    }

    try {
        const requestHost = String(req.get("Host") || "").split(":")[0].toLowerCase();
        return new URL(origin).hostname.toLowerCase() === requestHost;
    } catch {
        return false;
    }
}

// Form posts get a redirect; fetch callers that ask for JSON get the target.
function sendBackToManagementConsole(req, res) {
    if (req.accepts(["html", "json"]) === "json") {
        return res.status(200).json({ ok: true, redirectTo: MANAGEMENT_CONSOLE_USERS_PATH });
    }

    return res.redirect(303, MANAGEMENT_CONSOLE_USERS_PATH);
}

router.post("/api/admin/impersonation/professor/:id", async (req, res) => {
    try {
        if (!req.session?.uid) {
            return res.status(401).json({ error: "Unauthenticated" });
        }

        if (!isAuthorizedSuperAdmin(req)) {
            return res.status(403).json({ error: "Forbidden" });
        }

        const professorId = Number(req.params.id);

        if (!Number.isInteger(professorId) || professorId <= 0) {
            return res.status(400).json({ error: "Invalid target user" });
        }

        const db = await getDBInstance(pass.dbcon);
        const targetResult = await db.query(
            `
        SELECT id, role
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
            [professorId]
        );

        if (targetResult.rowCount === 0) {
            return res.status(404).json({ error: "Target user not found" });
        }

        const targetUser = targetResult.rows[0];

        if (targetUser.role !== "P") {
            return res.status(400).json({ error: "Target user must be a professor" });
        }

        req.session.uid = targetUser.id;
        req.session.role = "P";
        req.session.impersonating = true;

        if (!req.session.authUid) {
            req.session.authUid = Number(req.get("X-User-Id")) || null;
        }

        if (!req.session.authRole) {
            req.session.authRole = req.get("X-User-Role") || null;
        }

        return req.session.save((error) => {
            if (error) {
                return res.status(500).json({ error: "Unable to start impersonation" });
            }

            return res.status(200).json({
                ok:         true,
                redirectTo: "/home"
            });
        });
    } catch (error) {
        console.error("IMPERSONATION START ERROR:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// Ends the impersonation when the admin goes back to management-console
// (the "back to management console" form in home.ejs). The ethicapp session
// is destroyed rather than turned back into the admin's own identity, which
// has no use in ethicapp; the next ethicapp request starts a fresh session.
router.post("/api/admin/impersonation/stop", (req, res) => {
    try {
        if (!req.session?.uid) {
            return res.status(401).json({ error: "Unauthenticated" });
        }

        if (!isSameOriginRequest(req)) {
            return res.status(403).json({ error: "Forbidden" });
        }

        if (!isAuthorizedSuperAdmin(req)) {
            return res.status(403).json({ error: "Forbidden" });
        }

        if (!req.session.impersonating) {
            return sendBackToManagementConsole(req, res);
        }

        return req.session.destroy((error) => {
            if (error) {
                console.error("IMPERSONATION STOP ERROR:", error);
                return res.status(500).json({ error: "Unable to stop impersonation" });
            }

            // eslint-disable-next-line no-unused-vars
            const { maxAge, ...cookieOptions } = legacySessionCookieOptions();
            res.clearCookie(legacySessionCookieName(), cookieOptions);
            return sendBackToManagementConsole(req, res);
        });
    } catch (error) {
        console.error("IMPERSONATION STOP ERROR:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

export default router;

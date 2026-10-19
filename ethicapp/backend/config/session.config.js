import session from "express-session";
import { createLegacySessionStore } from "../db/session-redis.js";

let legacySessionMiddleware = null;

/**
 * Express session middleware shared by the HTTP app and the Socket.IO engine,
 * so both resolve the same session (including impersonation state).
 * @returns {import("express").RequestHandler}
 */
export function getLegacySessionMiddleware() {
    if (!legacySessionMiddleware) {
        legacySessionMiddleware = session({
            store:             createLegacySessionStore(),
            name:              process.env.ETHICAPP_SESSION_COOKIE_NAME || "ethicapp.sid",
            secret:            process.env.SESSION_SECRET || "legacy-dev-secret",
            resave:            false,
            saveUninitialized: false,
            cookie:            {
                httpOnly: true,
                secure:   process.env.ETHICAPP_SESSION_COOKIE_SECURE
                    ? process.env.ETHICAPP_SESSION_COOKIE_SECURE === "true"
                    : process.env.NODE_ENV === "production",
                sameSite: process.env.ETHICAPP_SESSION_COOKIE_SAMESITE || "lax",
                maxAge:   Number(
                    process.env.ETHICAPP_SESSION_COOKIE_MAX_AGE_MS || 24 * 60 * 60 * 1000,
                ),
            },
        });
    }

    return legacySessionMiddleware;
}

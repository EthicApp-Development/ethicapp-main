import express from "express";

import { isSuperAdminSession } from "../../helpers/auth-helper.js";
import aiServicesCatalogService, {
    isValidConnectionUrl,
} from "../../services/ai-services-catalog.service.js";

/**
 * Internal endpoints for the management console's AI services page (#816).
 *
 * Like the impersonation start endpoint, they are called by the console over
 * the internal network only (NGINX answers 404 for `/api/admin/` at the edge)
 * and authenticate the console the same way: the operator's forwarded session
 * must have role `S`.
 *
 * - `GET /api/admin/ai-services/catalog?locale=` reads the AI Additions
 *   catalog through the stored connection.
 * - `POST /api/admin/ai-services/connection-test` obtains a token and reads
 *   the catalog against `{ baseUrl, keycloakPublicUrl? }` without saving them.
 *
 * AI Additions failures are typed results (`ok: false` plus an error code)
 * with status 200; status codes other than 200 mean the request itself was
 * rejected or EthicApp failed.
 */

function requireSuperAdmin(req, res, next) {
    if (!req.session?.uid) {
        return res.status(401).json({ ok: false, error: "unauthenticated" });
    }
    if (!isSuperAdminSession(req)) {
        return res.status(403).json({ ok: false, error: "forbidden" });
    }
    return next();
}

function isAbsent(value) {
    return value === undefined || value === null || value === "";
}

// Returns the invalid field name, or null when the body is acceptable.
function invalidConnectionTestField(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return "body";
    }
    if (!isValidConnectionUrl(body.baseUrl)) {
        return "baseUrl";
    }
    if (!isAbsent(body.keycloakPublicUrl) && !isValidConnectionUrl(body.keycloakPublicUrl)) {
        return "keycloakPublicUrl";
    }
    return null;
}

// Logs EthicApp's own failure without its message, which may carry URLs.
function sendInternalError(res, route, error) {
    const details = [error?.name, error?.code].filter(Boolean).join(" ");
    console.error(`[ai-services] ${route} failed inside EthicApp${details ? `: ${details}` : ""}`);
    return res.status(500).json({ ok: false, error: "internal_error" });
}

/**
 * @param {object} [options]
 * @param {{ readCatalog: Function, testConnection: Function }} [options.catalogService]
 */
export function createAiServicesRouter({ catalogService = aiServicesCatalogService } = {}) {
    const router = express.Router();

    router.get("/api/admin/ai-services/catalog", requireSuperAdmin, async (req, res) => {
        try {
            const locale = typeof req.query.locale === "string" && req.query.locale
                ? req.query.locale
                : req.get("Accept-Language");
            const result = await catalogService.readCatalog({ locale });
            return res.status(200).json(result);
        } catch (error) {
            return sendInternalError(res, "catalog", error);
        }
    });

    router.post(
        "/api/admin/ai-services/connection-test",
        express.json({ limit: "16kb" }),
        requireSuperAdmin,
        async (req, res) => {
            const field = invalidConnectionTestField(req.body);
            if (field) {
                return res.status(400).json({ ok: false, error: "invalid_request", field });
            }

            try {
                const result = await catalogService.testConnection({
                    baseUrl:           req.body.baseUrl,
                    keycloakPublicUrl: isAbsent(req.body.keycloakPublicUrl)
                        ? null
                        : req.body.keycloakPublicUrl,
                    locale: req.get("Accept-Language"),
                });
                return res.status(200).json(result);
            } catch (error) {
                return sendInternalError(res, "connection test", error);
            }
        }
    );

    return router;
}

export default createAiServicesRouter();

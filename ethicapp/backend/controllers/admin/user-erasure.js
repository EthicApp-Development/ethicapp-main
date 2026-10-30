import express from "express";

import { isSuperAdminSession } from "../../helpers/auth-helper.js";
import {
    userErasureProcessor,
    userErasureRequestsStore,
} from "../../services/user-erasure/index.js";

/**
 * Internal endpoints for the management console's user page (#876): the AI
 * Additions erasure requests of a forgotten account.
 *
 * Like the other `/api/admin/` endpoints, they are called by the console over
 * the internal network only (NGINX answers 404 for `/api/admin/` at the edge)
 * and require the operator's forwarded session with role `S`.
 *
 * - `GET /api/admin/user-erasure/users/:id` lists the account's requests, one
 *   per AI Additions service.
 * - `POST /api/admin/user-erasure/users/:id/retry` sets every request that is
 *   not done back to pending, due now and with a fresh backoff, attempts them
 *   right away, and answers with the requests as they are then.
 *
 * Both answer `{ ok: true, userId, requests: [...] }`, where each request is
 * `{ serviceId, status, attempts, nextAttemptAt, lastAttemptAt, lastError,
 * requestedAt, completedAt }`; the retry adds `retried`, how many requests it
 * reset. An account without requests (not forgotten, or forgotten before
 * #876) has `requests: []`.
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

function parseUserId(value) {
    const userId = Number(value);
    return Number.isInteger(userId) && userId > 0 && userId <= 2147483647 ? userId : null;
}

function publicRequest(request) {
    return {
        serviceId:     request.serviceId,
        status:        request.status,
        attempts:      request.attempts,
        nextAttemptAt: request.nextAttemptAt,
        lastAttemptAt: request.lastAttemptAt,
        lastError:     request.lastError,
        requestedAt:   request.requestedAt,
        completedAt:   request.completedAt,
    };
}

function sendInternalError(res, route, error) {
    const details = [error?.name, error?.code].filter(Boolean).join(" ");
    console.error(`[user-erasure] ${route} failed inside EthicApp${details ? `: ${details}` : ""}`);
    return res.status(500).json({ ok: false, error: "internal_error" });
}

/**
 * @param {object} [options]
 * @param {{ listForUser: Function, resetForRetry: Function }} [options.store]
 * @param {{ processDue: Function }} [options.processor]
 */
export function createUserErasureRouter({
    store = userErasureRequestsStore,
    processor = userErasureProcessor,
} = {}) {
    // Case-sensitive like NGINX's locations.
    const router = express.Router({ caseSensitive: true });

    router.get("/api/admin/user-erasure/users/:id", requireSuperAdmin, async (req, res) => {
        const userId = parseUserId(req.params.id);
        if (!userId) {
            return res.status(400).json({ ok: false, error: "invalid_user_id" });
        }

        try {
            const requests = await store.listForUser(userId);
            return res.status(200).json({
                ok:       true,
                userId,
                requests: requests.map(publicRequest),
            });
        } catch (error) {
            return sendInternalError(res, "status", error);
        }
    });

    router.post("/api/admin/user-erasure/users/:id/retry", requireSuperAdmin, async (req, res) => {
        const userId = parseUserId(req.params.id);
        if (!userId) {
            return res.status(400).json({ ok: false, error: "invalid_user_id" });
        }

        try {
            const retried = await store.resetForRetry(userId);
            if (retried > 0) {
                await processor.processDue({ userId });
            }
            const requests = await store.listForUser(userId);
            return res.status(200).json({
                ok:       true,
                userId,
                retried,
                requests: requests.map(publicRequest),
            });
        } catch (error) {
            return sendInternalError(res, "retry", error);
        }
    });

    return router;
}

export default createUserErasureRouter();

import express from "express";
import { requireRole } from "../helpers/auth-helper.js";
import externalServicesRegistry from "../services/external-services.service.js";
import { callbackAuthMiddleware } from "../middleware/external-services-callback-auth.middleware.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = express.Router();

export async function processCallback({ serviceId, eventType, correlationId, eventId, payload, rawBody, auth, registry }) {
    if (!serviceId) {
        return {
            status: 400,
            body:   { status: "err", error: "Missing required field: serviceId." },
        };
    }

    if (eventId !== null && eventId !== undefined && !UUID_PATTERN.test(eventId)) {
        return {
            status: 400,
            body:   { status: "err", error: "eventId must be a valid UUID when provided." },
        };
    }

    await registry.initialize();

    try {
        registry.authorizeCallbackCaller(serviceId, auth);
    } catch (error) {
        return {
            status: error.statusCode || 403,
            body:   { status: "err", error: error.message },
        };
    }

    try {
        const { resultRecord, outcomes } = await registry.dispatchServiceHook(
            "callback-received",
            serviceId,
            {
                serviceId,
                eventType,
                correlationId,
                eventId:        eventId ?? null,
                requestPayload: payload,
                rawBody,
                auth,
            }
        );

        const correlationStatus = resultRecord?.job_id ? "matched" : "unknown";
        const isDuplicate       = resultRecord?.is_duplicate ?? false;

        return {
            status: 202,
            body:   {
                status: "accepted",
                result: {
                    serviceId,
                    eventType,
                    correlationId,
                    eventId:     eventId ?? null,
                    correlationStatus,
                    resultId:    resultRecord?.id ?? null,
                    isDuplicate,
                    dispatched:  outcomes.length,
                },
            },
        };
    } catch (error) {
        if (error.statusCode) {
            return {
                status: error.statusCode,
                body:   { status: "err", error: error.message },
            };
        }

        console.error("[external-services] Error dispatching callback-received hook.", error);
        return {
            status: 500,
            body:   { status: "err", error: "Internal server error." },
        };
    }
}

router.post("/external-services/callbacks", callbackAuthMiddleware, async (req, res) => {
    const serviceId     = typeof req.body?.serviceId === "string" ? req.body.serviceId.trim() : "";
    const eventType     = typeof req.body?.eventType === "string" ? req.body.eventType.trim() : "result";
    const correlationId = req.body?.correlationId ?? null;
    const eventId       = typeof req.body?.eventId === "string" ? req.body.eventId.trim() || null : null;
    const payload       = req.body?.payload ?? null;

    const { status, body } = await processCallback({
        serviceId,
        eventType,
        correlationId,
        eventId,
        payload,
        rawBody:  req.body,
        auth:     req.externalServiceAuth,
        registry: externalServicesRegistry,
    });

    return res.status(status).json(body);
});

router.get("/external-services", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    await externalServicesRegistry.initialize();
    return res.json({
        status: "ok",
        result: externalServicesRegistry.listServices(),
    });
});

export default router;

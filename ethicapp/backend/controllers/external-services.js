import express from "express";
import { requireRole } from "../helpers/auth-helper.js";
import externalServicesRegistry from "../services/external-services.service.js";

const router = express.Router();

router.post("/external-services/:service_id/results", async (req, res) => {
    const serviceId = String(req.params.service_id || "").trim();
    const bodyServiceId = req.body?.serviceId ? String(req.body.serviceId).trim() : "";

    if (!serviceId) {
        return res.status(400).json({
            status: "err",
            error:  "Missing external service id.",
        });
    }

    if (bodyServiceId && bodyServiceId !== serviceId) {
        return res.status(409).json({
            status: "err",
            error:  "Request serviceId does not match the callback route service id.",
        });
    }

    try {
        const dispatchResults = await externalServicesRegistry.dispatchServiceHook(
            "external-service-result",
            serviceId,
            {
                serviceId,
                requestPayload: req.body,
            }
        );

        return res.status(202).json({
            status: "accepted",
            result: {
                serviceId,
                dispatched: dispatchResults.length,
            },
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                status: "err",
                error:  error.message,
            });
        }

        console.error("[external-services] Error handling external service result.", error);
        return res.status(500).json({
            status: "err",
            error:  "Internal server error.",
        });
    }
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

router.get("/external-services/results", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    await externalServicesRegistry.initialize();
    return res.json({
        status: "ok",
        result: externalServicesRegistry.listResults(),
    });
});

export default router;

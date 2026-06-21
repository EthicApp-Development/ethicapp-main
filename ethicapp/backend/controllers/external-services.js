import express from "express";
import { requireRole } from "../helpers/auth-helper.js";
import externalServicesRegistry from "../services/external-services.service.js";
import { externalServiceJobsService } from "../services/external-service-jobs.service.js";
import { callbackAuthMiddleware } from "../middleware/external-services-callback-auth.middleware.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseIntParam(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
}

function parseDateParam(value) {
    if (typeof value !== "string" || !value) {
        return null;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const router = express.Router();

export async function processCallback({ serviceId, eventType, correlationId, payload, rawBody, auth, registry }) {
    if (!serviceId) {
        return {
            status: 400,
            body:   { status: "err", error: "Missing required field: serviceId." },
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
                    correlationStatus,
                    resultId:   resultRecord?.id ?? null,
                    isDuplicate,
                    dispatched: outcomes.length,
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
    const payload       = req.body?.payload ?? null;

    const { status, body } = await processCallback({
        serviceId,
        eventType,
        correlationId,
        payload,
        rawBody:  req.body,
        auth:     req.externalServiceAuth,
        registry: externalServicesRegistry,
    });

    return res.status(status).json(body);
});

export async function listJobs(params, jobsService) {
    const serviceId = typeof params?.serviceId === "string" ? params.serviceId.trim() || null : null;
    const sessionId = parseIntParam(params?.sessionId);
    const phaseId   = parseIntParam(params?.phaseId);
    const status    = typeof params?.status === "string" ? params.status.trim() || null : null;
    const from      = parseDateParam(params?.from);
    const to        = parseDateParam(params?.to);
    const limit     = parseIntParam(params?.limit) ?? 50;

    const jobs = await jobsService.queryRecentJobs({ serviceId, sessionId, phaseId, status, from, to, limit });
    return {
        status: 200,
        body:   { status: "ok", result: jobs },
    };
}

export async function getJobDetail(jobId, jobsService) {
    if (!jobId || !UUID_PATTERN.test(jobId)) {
        return {
            status: 400,
            body:   { status: "err", error: "Invalid or missing job id." },
        };
    }

    const job = await jobsService.getJob(jobId);
    if (!job) {
        return {
            status: 404,
            body:   { status: "err", error: "Job not found." },
        };
    }

    const results = await jobsService.getJobResults(jobId);
    return {
        status: 200,
        body:   { status: "ok", result: { job, results } },
    };
}

export async function listResults(params, jobsService) {
    const serviceId = typeof params?.serviceId === "string" ? params.serviceId.trim() || null : null;
    const sessionId = parseIntParam(params?.sessionId);
    const phaseId   = parseIntParam(params?.phaseId);
    const status    = typeof params?.status === "string" ? params.status.trim() || null : null;
    const from      = parseDateParam(params?.from);
    const to        = parseDateParam(params?.to);
    const limit     = parseIntParam(params?.limit) ?? 50;

    const results = await jobsService.queryRecentResults({ serviceId, sessionId, phaseId, status, from, to, limit });
    return {
        status: 200,
        body:   { status: "ok", result: results },
    };
}

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

router.get("/external-services/jobs", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    const { status, body } = await listJobs(req.query, externalServiceJobsService);
    return res.status(status).json(body);
});

router.get("/external-services/jobs/:jobId", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    const { status, body } = await getJobDetail(req.params.jobId, externalServiceJobsService);
    return res.status(status).json(body);
});

router.get("/external-services/results", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    const { status, body } = await listResults(req.query, externalServiceJobsService);
    return res.status(status).json(body);
});

export default router;

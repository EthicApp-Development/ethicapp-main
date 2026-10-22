import express from "express";
import * as config from "../config/database.config.js";
import { execSQL, param } from "../db/rest-pg-2.js";
import { requireRole } from "../helpers/auth-helper.js";
import externalServicesRegistry, { SERVICE_SCOPES } from "../services/external-services.service.js";
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

// Canonical locale rule (AGENTS.md): Spanish only when the locale is Spanish.
function normalizeLocale(value) {
    return /^es(?:[-_]|$)/iu.test(String(value || "").trim()) ? "es_CL" : "en_US";
}

// The teacher's stored `preferred_locale`, or else the first language of the
// request's Accept-Language header (#728).
export function resolveTeacherLocale({ preferredLocale, acceptedLanguages = [] }) {
    if (typeof preferredLocale === "string" && preferredLocale.trim()) {
        return normalizeLocale(preferredLocale);
    }

    return normalizeLocale(acceptedLanguages.find(language => language !== "*"));
}

// What the listing tells the design editor about a service's capability
// descriptor: its id, whether it can be fetched now, and its name and LLM use.
function summarizeDescriptor(service, configuration) {
    if (!service.descriptor) {
        return null;
    }

    const available = configuration?.available === true;
    return {
        serviceId: service.descriptor.serviceId,
        available,
        name:      available ? configuration.name : null,
        usesLlm:   available ? configuration.usesLlm : null,
    };
}

// Only enabled services are listed (#686): disabled ones are not offered to
// teachers. With `scope` (one value or several), the list is narrowed to the
// services that declare at least one of those scopes. Each service carries the
// UI translations its adapter provides, or null, and a summary of its capability
// descriptor in `locale` (#728), or null when it declares none.
export async function listExternalServices({ scope, registry, locale = "en_US" }) {
    const scopes = scope === undefined ? [] : [scope].flat();

    if (scopes.some(value => !SERVICE_SCOPES.includes(value))) {
        return {
            status: 400,
            body:   { status: "err", error: `scope must be one of: ${SERVICE_SCOPES.join(", ")}.` },
        };
    }

    await registry.initialize();
    const services = registry.listServices().filter(service => service.enabled
        && (scopes.length === 0
            || service.scopes.some(serviceScope => scopes.includes(serviceScope))));

    const result = await Promise.all(services.map(async (service) => {
        const [translations, configuration] = await Promise.all([
            registry.getServiceUiTranslations(service.id),
            service.descriptor
                ? registry.getServiceInstanceConfiguration(service.id, locale)
                : null,
        ]);

        return {
            ...service,
            ui:         { ...service.ui, translations },
            descriptor: summarizeDescriptor(service, configuration),
        };
    }));

    return {
        status: 200,
        body:   { status: "ok", result },
    };
}

// The instance configuration a service's capability descriptor advertises, for
// the design editor (#728). 404 for unknown or disabled services and services
// without a descriptor; `available: false` when the descriptor cannot be
// fetched. The service's runtime configuration and its routes stay internal.
export async function getExternalServiceInstanceConfiguration({
    serviceId,
    registry,
    locale = "en_US",
}) {
    await registry.initialize();
    const configuration = await registry.getServiceInstanceConfiguration(serviceId, locale);

    if (!configuration) {
        return {
            status: 404,
            body:   {
                status: "err",
                error:  "Unknown external service or no instance configuration.",
            },
        };
    }

    const result = configuration.available
        ? {
            serviceId,
            available: true,
            stale:     configuration.stale === true,
            name:      configuration.name,
            usesLlm:   configuration.usesLlm,
            locale:    normalizeLocale(configuration.locale),
            fields:    configuration.fields,
        }
        : { serviceId, available: false, reason: configuration.reason };

    return {
        status: 200,
        body:   { status: "ok", result },
    };
}

async function loadPreferredLocale(userId) {
    try {
        const rows = await execSQL({
            dbcon:     config.dbconnString,
            sql:       "SELECT preferred_locale FROM users WHERE id = $1 LIMIT 1",
            sqlParams: [param("plain", userId)],
        });
        return rows[0]?.preferred_locale ?? null;
    } catch (error) {
        console.warn("[external-services] Could not read the teacher's preferred locale.", error);
        return null;
    }
}

async function teacherLocale(req) {
    return resolveTeacherLocale({
        preferredLocale:   await loadPreferredLocale(req.session.uid),
        acceptedLanguages: req.acceptsLanguages(),
    });
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

    const { status, body } = await listExternalServices({
        scope:    req.query.scope,
        registry: externalServicesRegistry,
        locale:   await teacherLocale(req),
    });

    return res.status(status).json(body);
});

router.get("/external-services/:id/instance-configuration", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const { status, body } = await getExternalServiceInstanceConfiguration({
        serviceId: req.params.id,
        registry:  externalServicesRegistry,
        locale:    await teacherLocale(req),
    });

    return res.status(status).json(body);
});

export default router;

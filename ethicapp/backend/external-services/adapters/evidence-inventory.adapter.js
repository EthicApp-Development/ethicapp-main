import { randomUUID } from "crypto";
import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";
import {
    completeEvidenceInventoryJob,
    failEvidenceInventoryJob,
    markEvidenceInventoryProcessing,
} from "../../helpers/case-evidence-inventories-helper.js";
import { normalizeEvidenceInventory } from "../../helpers/evidence-inventory-document.js";

/**
 * Evidence inventory adapter.
 *
 * When a case document is ready, it asks the Argumentation Tutor to draft the
 * case evidence inventory (POST /evidence-inventories, contract
 * evidence-inventory-request/v1). The tutor answers asynchronously through the
 * unified callback endpoint with an evidence-inventory-result/v1 payload, and
 * the adapter stores the draft as case metadata for teacher review.
 *
 * The external-service job stays open after a successful request: the tutor
 * callback completes it.
 */

const DEFAULT_TUTOR_BASE_PATH = "/argumentation-tutor/api/v2";
const REQUEST_SCHEMA_VERSION = "evidence-inventory-request/v1";
const MAX_CASE_TITLE_LENGTH = 500;
const MAX_CASE_TEXT_LENGTH = 200000;
const LANGUAGE_PATTERN = /^[a-z]{2}([_-][A-Z]{2})?$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

let aiAdditionsClient = defaultAiAdditionsClient;

function normalizeText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value).trim();
}

export function getTutorApiBaseUrl(client = aiAdditionsClient) {
    return normalizeText(process.env.AI_ADDITIONS_ARGUMENTATION_TUTOR_API_BASE_URL)
        || client.buildServiceUrl(DEFAULT_TUTOR_BASE_PATH);
}

export function buildEvidenceInventoryRequest({
    caseId,
    caseTitle,
    caseText,
    languageCode,
    correlationId,
}) {
    const languageCodeText = normalizeText(languageCode);
    const request = {
        schemaVersion: REQUEST_SCHEMA_VERSION,
        case:          {
            id:    String(caseId),
            title: (normalizeText(caseTitle) || `Case ${caseId}`).slice(0, MAX_CASE_TITLE_LENGTH),
            text:  normalizeText(caseText).slice(0, MAX_CASE_TEXT_LENGTH),
        },
        clientContext: {
            service: "ethicapp",
            correlationId,
            caseId,
        },
    };

    if (LANGUAGE_PATTERN.test(languageCodeText)) {
        request.case.language = languageCodeText;
    }

    return request;
}

function describeProviderError(error) {
    const code = normalizeText(error?.code);
    const message = normalizeText(error?.message) || "The evidence inventory generation failed.";
    return code ? `${code}: ${message}` : message;
}

function createDependencies(overrides = {}) {
    return {
        markProcessing: markEvidenceInventoryProcessing,
        completeJob:    completeEvidenceInventoryJob,
        failJob:        failEvidenceInventoryJob,
        createJobId:    randomUUID,
        ...overrides,
    };
}

async function requestInventory({ context, callback, service, dependencies }) {
    const caseId = Number(context.caseId);
    // Without a job row there is no correlation id; a local one still lets
    // the callback find this generation.
    const jobId = normalizeText(context.correlationId) || dependencies.createJobId();
    const caseText = normalizeText(context.caseText);

    await dependencies.markProcessing({ caseId, serviceId: service.id, jobId });

    if (!caseText) {
        await dependencies.failJob({
            jobId,
            errorMessage: "The case document has no extractable text.",
        });
        await callback({
            serviceId: service.id,
            hook:      "case-document-ready",
            status:    "skipped",
            payload:   { caseId, reason: "empty_case_text" },
        });
        return;
    }

    try {
        const response = await aiAdditionsClient.requestJson("/evidence-inventories", {
            method:  "POST",
            baseUrl: getTutorApiBaseUrl(),
            body:    buildEvidenceInventoryRequest({
                caseId,
                caseTitle:     context.caseTitle,
                caseText,
                languageCode:  context.languageCode,
                correlationId: jobId,
            }),
        });
        const taskId = response?.taskId ?? "unknown";
        console.info(`[evidence-inventory] Case ${caseId}: inventory task ${taskId}.`);
    } catch (error) {
        console.warn(`[evidence-inventory] Request failed for case ${caseId}.`, error);
        await dependencies.failJob({
            jobId,
            errorMessage: "The evidence inventory service could not be reached.",
        });
        await callback({
            serviceId: service.id,
            hook:      "case-document-ready",
            status:    "failed",
            payload:   {
                caseId,
                reason:     "request_failed",
                statusCode: error?.statusCode ?? null,
            },
        });
    }
}

async function storeInventoryResult({ context, callback, service, dependencies }) {
    const payload = context.requestPayload || {};
    const jobId = normalizeText(context.correlationId)
        || normalizeText(payload.clientContext?.correlationId);

    if (!UUID_PATTERN.test(jobId)) {
        await callback({
            serviceId: service.id,
            hook:      "callback-received",
            status:    "failed",
            payload:   { reason: "invalid_correlation_id" },
        });
        return;
    }

    if (payload.status === "completed") {
        let inventory;
        try {
            inventory = normalizeEvidenceInventory(payload.inventory);
        } catch (error) {
            console.warn(`[evidence-inventory] Invalid inventory (${jobId}).`, error.details);
            await dependencies.failJob({
                jobId,
                errorMessage: "The generated inventory breaks the inventory contract.",
            });
            await callback({
                serviceId: service.id,
                hook:      "callback-received",
                status:    "failed",
                payload:   { reason: "invalid_inventory" },
            });
            return;
        }

        const row = await dependencies.completeJob({ jobId, inventory });
        await callback({
            serviceId: service.id,
            hook:      "callback-received",
            status:    row ? "completed" : "skipped",
            payload:   row
                ? {
                    caseId:     row.case_id,
                    facts:      inventory.facts.length,
                    exclusions: inventory.exclusions.length,
                }
                : { reason: "superseded_job" },
        });
        return;
    }

    if (payload.status === "failed") {
        const row = await dependencies.failJob({
            jobId,
            errorMessage: describeProviderError(payload.error),
        });
        await callback({
            serviceId: service.id,
            hook:      "callback-received",
            status:    row ? "failed" : "skipped",
            payload:   row
                ? {
                    caseId: row.case_id,
                    reason: normalizeText(payload.error?.code) || "generation_failed",
                }
                : { reason: "superseded_job" },
        });
        return;
    }

    await callback({
        serviceId: service.id,
        hook:      "callback-received",
        status:    "failed",
        payload:   { reason: "unsupported_status" },
    });
}

export async function register({
    service,
    subscribe,
    aiAdditionsClient: providedAiAdditionsClient,
    evidenceInventoryDependencies = {},
}) {
    aiAdditionsClient = providedAiAdditionsClient || defaultAiAdditionsClient;

    const dependencies = createDependencies(evidenceInventoryDependencies);

    subscribe("case-document-ready", async (context, { callback }) => {
        try {
            await requestInventory({ context, callback, service, dependencies });
        } catch (error) {
            await callback({
                serviceId: service.id,
                hook:      "case-document-ready",
                status:    "failed",
                error:     normalizeText(error?.message) || "Unexpected adapter error.",
            });
        }
    });

    subscribe("callback-received", async (context, { callback }) => {
        try {
            await storeInventoryResult({ context, callback, service, dependencies });
        } catch (error) {
            await callback({
                serviceId: service.id,
                hook:      "callback-received",
                status:    "failed",
                error:     normalizeText(error?.message) || "Unexpected result error.",
            });
        }
    });
}

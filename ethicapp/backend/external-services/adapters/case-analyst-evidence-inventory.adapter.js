import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";
import {
    waitForCaseDocumentText as defaultWaitForCaseDocumentText,
} from "../../helpers/case-document-render-helper.js";
import {
    EvidenceInventoryValidationError,
    INVENTORY_SCHEMA_VERSION,
    normalizeEvidenceInventory,
} from "../../helpers/evidence-inventory-document.js";

/**
 * Evidence inventory from Case Analyst (#652, epic #647; service side:
 * ethicapp-ai-additions epic #843, sub-issue 08).
 *
 * An evidence inventory is the closed list of the facts of a case that a
 * student may invoke as evidence, each with a literal quote, plus plausible
 * statements the case does not make (evidence-inventory/v1). Case Analyst
 * drafts it; the teacher reviews it in the case view tab.
 *
 * Flow:
 * 1. `case-created` (only for cases whose author chose this service) starts
 *    the reserved generation, waits for the PDF worker to extract the case
 *    text and sends `POST /case-analyst/api/v1/evidence-inventories`
 *    (evidence-inventory-request/v1) with the job id as correlation id. The
 *    service answers 202 and the job stays `dispatched`.
 * 2. Case Analyst posts an evidence-inventory-result/v1 callback with this
 *    adapter's id as serviceId. `callback-received` stores the inventory, or
 *    the failure, in the case analysis. Results of superseded generations are
 *    ignored by the case analyses store.
 * 3. Teacher edits go through `PUT /cases/:id/analyses/:serviceId`, checked
 *    by validateCaseAnalysisDocument(), which verifies every quote again
 *    against the case text.
 */

export const CASE_ANALYST_API_BASE_PATH = "/case-analyst/api/v1";
export const EVIDENCE_INVENTORIES_PATH  = "/evidence-inventories";
export const REQUEST_SCHEMA_VERSION     = "evidence-inventory-request/v1";
export const RESULT_SCHEMA_VERSION      = "evidence-inventory-result/v1";
export const DOCUMENT_SCHEMA            = INVENTORY_SCHEMA_VERSION;

const CASE_CREATED_HOOK      = "case-created";
const CALLBACK_RECEIVED_HOOK = "callback-received";
const LOG_PREFIX             = "[case-analyst-evidence-inventory]";

// Limits of the request envelope (case-request-envelope/v1).
const MAX_CASE_TITLE_LENGTH = 500;
const MAX_CASE_TEXT_LENGTH  = 200000;

// Case Analyst does not publish translated texts yet, so this adapter
// provides them until the service does.
const DESCRIPTION_ES_CL = "Lista los hechos del caso que los estudiantes pueden usar como "
    + "evidencia, cada uno con su cita literal, y las afirmaciones verosímiles que el caso no "
    + "hace. Revisas y editas el borrador.";
const DESCRIPTION_EN_US = "Lists the facts of the case that students may invoke as evidence, "
    + "each with its literal quote, and plausible statements the case does not make. You review "
    + "and edit the draft.";

const UI_TRANSLATIONS = {
    es_CL: {
        label:       "Inventario de evidencias",
        description: DESCRIPTION_ES_CL,
        tabTitle:    "Inventario de evidencias",
    },
    en_US: {
        label:       "Evidence inventory",
        description: DESCRIPTION_EN_US,
        tabTitle:    "Evidence inventory",
    },
};

// Error messages for each outcome of the render wait other than "ready".
const RENDER_FAILURES = {
    "no-document":   "The case has no document.",
    "render-failed": "The case document could not be rendered.",
    "superseded":    "A newer document replaced the case document.",
    "timeout":       "The case document was not rendered in time.",
};

// Case Analyst's public failure codes (evidence-inventory-result/v1) mapped to
// the shared case analysis codes, which the case view explains in the
// teacher's language (README, "Error codes"). Unknown codes count as an
// internal error; error_message keeps the service's sanitized message.
export const SERVICE_ERROR_CODES = Object.freeze({
    llm_error:            "service-llm-error",
    llm_request_failed:   "service-llm-error",
    llm_not_configured:   "service-llm-error",
    llm_tier_unsupported: "service-llm-error",
    llm_refused:          "service-llm-refusal",
    llm_output_invalid:   "service-invalid-output",
    llm_output_truncated: "service-invalid-output",
    inventory_invalid:    "service-invalid-output",
    inventory_too_large:  "service-invalid-output",
    timeout:              "service-timeout",
    worker_lost:          "service-worker-lost",
    internal_error:       "service-internal-error",
});
const UNKNOWN_SERVICE_ERROR = "service-internal-error";

const FAILURES = {
    emptyText: {
        errorCode:    "empty-case-text",
        errorMessage: "The case document has no extractable text.",
    },
    textTooLong: {
        errorCode:    "case-text-too-long",
        errorMessage: `The case text is longer than the ${MAX_CASE_TEXT_LENGTH} characters `
            + "Case Analyst accepts.",
    },
    requestFailed: {
        errorCode:    "request-failed",
        errorMessage: "The evidence inventory service could not be reached.",
    },
    rejected: {
        errorCode:    "request-rejected",
        errorMessage: "The evidence inventory service rejected the request.",
    },
    invalidResult: {
        errorCode:    "invalid-result",
        errorMessage: "The evidence inventory service sent a result EthicApp does not understand.",
    },
    invalidInventory: {
        errorCode:    "invalid-result",
        errorMessage: "The generated inventory breaks the evidence inventory contract.",
    },
    unexpected: {
        errorCode:    "adapter-error",
        errorMessage: "The evidence inventory failed unexpectedly.",
    },
};

let aiAdditionsClient = defaultAiAdditionsClient;

function normalizeText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value).trim();
}

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * The output language Case Analyst accepts (`es_CL` or `en_US`), following
 * the repository locale policy: Spanish for `es` and `es_*`, English otherwise.
 * A case without a language code is `es_CL`, the column default (as in the
 * case evaluation adapter).
 */
export function normalizeCaseLanguage(languageCode) {
    const code = normalizeText(languageCode);
    if (!code) {
        return "es_CL";
    }
    return /^es(?:[_-]|$)/iu.test(code) ? "es_CL" : "en_US";
}

export async function getUiTranslations() {
    return UI_TRANSLATIONS;
}

/**
 * Builds the evidence-inventory-request/v1 body: the Case Analyst request
 * envelope with no fields of its own. `clientContext` is echoed in the
 * result, and its `correlationId` (the job id) becomes the callback's.
 */
export function buildEvidenceInventoryRequest({
    serviceId,
    caseId,
    caseTitle,
    caseText,
    languageCode,
    correlationId,
}) {
    const id = String(caseId);

    return {
        schemaVersion: REQUEST_SCHEMA_VERSION,
        case:          {
            id,
            title:    (normalizeText(caseTitle) || `Case ${id}`).slice(0, MAX_CASE_TITLE_LENGTH),
            text:     normalizeText(caseText),
            language: normalizeCaseLanguage(languageCode),
        },
        clientContext: {
            service: serviceId,
            correlationId,
            caseId:  id,
        },
    };
}

/**
 * Checks a teacher edit of an inventory (PUT /cases/:id/analyses/:serviceId).
 * Every quote is verified again against the case text, so `sourceQuoteFound`
 * never comes from the client. When the text cannot be read, every quote is
 * reported as not found.
 */
export async function validateCaseAnalysisDocument(document, {
    caseId = null,
    languageCode = null,
    getCaseText = async () => "",
} = {}) {
    let caseText = "";
    try {
        const text = await getCaseText();
        caseText = typeof text === "string" ? text : "";
    } catch (error) {
        console.warn(`${LOG_PREFIX} Case ${caseId} text is not available.`, error);
    }

    try {
        return {
            documentSchema: DOCUMENT_SCHEMA,
            document:       normalizeEvidenceInventory(document, {
                caseText,
                language: normalizeCaseLanguage(languageCode),
            }),
        };
    } catch (error) {
        if (error instanceof EvidenceInventoryValidationError) {
            return { errors: error.details };
        }
        throw error;
    }
}

async function requestEvidenceInventory(body) {
    return aiAdditionsClient.requestJson(EVIDENCE_INVENTORIES_PATH, {
        method:   "POST",
        body,
        basePath: CASE_ANALYST_API_BASE_PATH,
    });
}

// A 4xx answer means Case Analyst refused this request; anything else (no
// connection, network errors, 5xx) means it could not be reached.
function requestFailure(error) {
    const statusCode = Number(error?.statusCode);
    return statusCode >= 400 && statusCode < 500 ? FAILURES.rejected : FAILURES.requestFailed;
}

// Fails a started generation without masking the error that caused it.
async function failQuietly(caseAnalyses, jobId, failure) {
    try {
        await caseAnalyses.fail({ jobId, ...failure });
    } catch (error) {
        console.warn(`${LOG_PREFIX} Could not record the failed generation.`, error);
    }
}

async function processCaseCreated({ context, callback }, adapter) {
    const { service, caseAnalyses, waitForCaseDocumentText } = adapter;
    const caseId = toPositiveInteger(context.caseId);
    if (!caseId) {
        await callback({ hook: CASE_CREATED_HOOK, status: "skipped", reason: "Missing caseId." });
        return;
    }

    const analysis = await caseAnalyses.markProcessing({ caseId, jobId: context.jobId });
    if (!analysis) {
        await callback({
            hook:   CASE_CREATED_HOOK,
            status: "skipped",
            reason: "The generation is no longer the one reserved for the case.",
        });
        return;
    }

    const fail = async (failure, extra = {}) => {
        await caseAnalyses.fail({ jobId: analysis.jobId, ...failure });
        await callback({
            hook:   CASE_CREATED_HOOK,
            status: "failed",
            caseId,
            error:  failure.errorMessage,
            ...extra,
        });
    };

    try {
        const outcome = await waitForCaseDocumentText(caseId);
        if (outcome.status !== "ready") {
            await fail({
                errorCode:    outcome.status,
                errorMessage: RENDER_FAILURES[outcome.status]
                    ?? "The case document is not available.",
            });
            return;
        }

        const caseText = normalizeText(outcome.text);
        if (!caseText) {
            await fail(FAILURES.emptyText);
            return;
        }
        if (caseText.length > MAX_CASE_TEXT_LENGTH) {
            await fail(FAILURES.textTooLong);
            return;
        }

        const body = buildEvidenceInventoryRequest({
            serviceId:     service.id,
            caseId,
            caseTitle:     context.title,
            caseText,
            languageCode:  context.languageCode,
            correlationId: analysis.jobId,
        });

        let response;
        try {
            response = await requestEvidenceInventory(body);
        } catch (error) {
            console.warn(`${LOG_PREFIX} Request failed for case ${caseId}.`, error);
            await fail(requestFailure(error), { statusCode: error?.statusCode ?? null });
            return;
        }

        // The job stays dispatched: the Case Analyst callback completes it.
        console.info(`${LOG_PREFIX} Case ${caseId}: task ${response?.taskId ?? "unknown"}.`);
    } catch (error) {
        // The generation started, so it is failed here rather than left
        // 'processing' until it is stale. register() reports the error.
        await failQuietly(caseAnalyses, analysis.jobId, FAILURES.unexpected);
        throw error;
    }
}

function describeServiceFailure(error) {
    const code = normalizeText(error?.code);
    const errorCode = Object.hasOwn(SERVICE_ERROR_CODES, code)
        ? SERVICE_ERROR_CODES[code]
        : UNKNOWN_SERVICE_ERROR;
    return {
        errorCode,
        errorMessage: normalizeText(error?.message) || "The evidence inventory generation failed.",
    };
}

// Validates a completed result and returns the inventory to store, or null.
function readGeneratedInventory(payload) {
    if (payload.inventory?.schemaVersion !== INVENTORY_SCHEMA_VERSION) {
        return null;
    }

    try {
        // The service already checked the quotes against the same text, so
        // its sourceQuoteFound flags are kept.
        return normalizeEvidenceInventory(payload.inventory);
    } catch (error) {
        if (error instanceof EvidenceInventoryValidationError) {
            console.warn(`${LOG_PREFIX} Invalid inventory.`, error.details);
            return null;
        }
        throw error;
    }
}

async function processResult({ context, callback, caseAnalyses }) {
    const jobId = normalizeText(context.correlationId);
    const payload = context.requestPayload ?? {};

    const report = async (row, outcome, details = {}) => {
        await callback({
            hook:   CALLBACK_RECEIVED_HOOK,
            status: row ? outcome : "skipped",
            ...(row
                ? { caseId: row.case_id ?? null, ...details }
                : { reason: "superseded-generation" }),
        });
    };

    if (!jobId) {
        await callback({
            hook:   CALLBACK_RECEIVED_HOOK,
            status: "failed",
            reason: "missing-correlation-id",
        });
        return;
    }

    // The echoed client context must name the same request as the callback;
    // otherwise the result is refused and the analysis left as it is.
    const echoedJobId = payload.clientContext?.correlationId;
    if (echoedJobId !== undefined && echoedJobId !== null && String(echoedJobId) !== jobId) {
        await callback({
            hook:   CALLBACK_RECEIVED_HOOK,
            status: "failed",
            reason: "correlation-mismatch",
        });
        return;
    }

    if (payload.schemaVersion !== RESULT_SCHEMA_VERSION
        || !["completed", "failed"].includes(payload.status)) {
        const row = await caseAnalyses.fail({ jobId, ...FAILURES.invalidResult });
        await report(row, "failed", { reason: FAILURES.invalidResult.errorCode });
        return;
    }

    if (payload.status === "failed") {
        const failure = describeServiceFailure(payload.error);
        const row = await caseAnalyses.fail({ jobId, ...failure });
        await report(row, "failed", { reason: failure.errorCode });
        return;
    }

    const inventory = readGeneratedInventory(payload);
    if (!inventory) {
        const row = await caseAnalyses.fail({ jobId, ...FAILURES.invalidInventory });
        await report(row, "failed", { reason: FAILURES.invalidInventory.errorCode });
        return;
    }

    const row = await caseAnalyses.complete({
        jobId,
        documentSchema: DOCUMENT_SCHEMA,
        document:       inventory,
    });
    await report(row, "completed", {
        facts:      inventory.facts.length,
        exclusions: inventory.exclusions.length,
    });
}

export async function register({
    service,
    subscribe,
    aiAdditionsClient: providedAiAdditionsClient,
    caseAnalyses,
    evidenceInventoryDependencies = {},
}) {
    aiAdditionsClient = providedAiAdditionsClient || defaultAiAdditionsClient;
    const adapter = {
        service,
        caseAnalyses,
        waitForCaseDocumentText: evidenceInventoryDependencies.waitForCaseDocumentText
            ?? defaultWaitForCaseDocumentText,
    };

    subscribe(CASE_CREATED_HOOK, async (context, { callback }) => {
        try {
            await processCaseCreated({ context, callback }, adapter);
        } catch (error) {
            await callback({
                hook:   CASE_CREATED_HOOK,
                status: "failed",
                error:  normalizeText(error?.message) || "Unexpected evidence inventory error.",
            });
        }
    });

    subscribe(CALLBACK_RECEIVED_HOOK, async (context, { callback }) => {
        try {
            await processResult({ context, callback, caseAnalyses });
        } catch (error) {
            const jobId = normalizeText(context.correlationId);
            if (jobId) {
                await failQuietly(caseAnalyses, jobId, FAILURES.unexpected);
            }
            await callback({
                hook:   CALLBACK_RECEIVED_HOOK,
                status: "failed",
                error:  normalizeText(error?.message)
                    || "Unexpected evidence inventory result error.",
            });
        }
    });
}

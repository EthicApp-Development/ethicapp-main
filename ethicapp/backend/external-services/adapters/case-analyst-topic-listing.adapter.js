import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";
import {
    waitForCaseDocumentText as defaultWaitForCaseDocumentText,
} from "../../helpers/case-document-render-helper.js";
import {
    checkTopicListingDocument,
    normalizeTopicListingEdit,
    TOPIC_LISTING_SCHEMA,
} from "../../helpers/topic-listing-document.js";

// Topic listing from Case Analyst (#845, epic #647): the topics participants
// must address when they discuss a case in small groups. It ports the
// "pedagogical minute" of Justin Pinto's prototype, which kept the list in
// the browser only; here it is a case analysis the teacher edits.
//
// On `case-created` the adapter starts the reserved generation, waits for the
// extracted case text and posts a `topic-listing-request/v1` to Case Analyst,
// which answers 202 and lists the topics asynchronously (about twenty
// seconds). The result arrives as a `callback-received` with a
// `topic-listing-result/v1` payload, correlated with the job id the request
// carried, and is stored as the case analysis (`topic-listing/v1`).
//
// Teacher edits go through `PUT /cases/:id/analyses/:serviceId`, checked by
// validateCaseAnalysisDocument() (helpers/topic-listing-document.js).
//
// The contract lives in ethicapp-ai-additions,
// case-analyst/app/modules/topic_listing/ (schemas/ and examples/).

// The Case Analyst API under the AI Additions connection's base URL (#814).
export const CASE_ANALYST_API_BASE_PATH = "/case-analyst/api/v1";
export const TOPIC_LISTINGS_PATH        = "/topic-listings";

export const TOPIC_LISTING_REQUEST_SCHEMA = "topic-listing-request/v1";
export { TOPIC_LISTING_SCHEMA };
export const TOPIC_LISTING_RESULT_SCHEMA  = "topic-listing-result/v1";

const CASE_CREATED_HOOK      = "case-created";
const CALLBACK_RECEIVED_HOOK = "callback-received";
const CLIENT_SERVICE         = "case-analyst-topic-listing";
const LOG_PREFIX             = "[case-analyst-topic-listing]";

// Limits of the request envelope (case-request-envelope/v1).
const MAX_TITLE_LENGTH = 500;
const MAX_TEXT_LENGTH  = 200000;
// Stored error messages are kept short; the service's are at most 1000.
const MAX_ERROR_MESSAGE_LENGTH = 500;

// Case Analyst does not publish translated texts yet, so this adapter
// provides them until the service does.
const DESCRIPTION_ES_CL = "Lista los temas que los participantes deben abordar al discutir "
    + "el caso. Revisas y editas el borrador.";
const DESCRIPTION_EN_US = "Lists the topics participants must address when they discuss the "
    + "case. You review and edit the draft.";

const UI_TRANSLATIONS = {
    es_CL: {
        label:       "Listado de temas",
        description: DESCRIPTION_ES_CL,
        tabTitle:    "Temas",
    },
    en_US: {
        label:       "Topic listing",
        description: DESCRIPTION_EN_US,
        tabTitle:    "Topics",
    },
};

// Error messages for each outcome of the render wait other than "ready".
const RENDER_FAILURES = {
    "no-document":   "The case has no document.",
    "render-failed": "The case document could not be rendered.",
    "superseded":    "A newer document replaced the case document.",
    "timeout":       "The case document was not rendered in time.",
};

// The failure codes of a failed `topic-listing-result/v1` are Case Analyst's
// core codes ("Bounded jobs" in case-analyst/README.md). They are recorded
// under the shared case analysis codes (README, "Error codes"), which the
// case view explains in the teacher's language: Case Analyst's `timeout` is
// not the render timeout of the case document.
export const SERVICE_ERROR_CODES = Object.freeze({
    llm_error:            "service-llm-error",
    llm_request_failed:   "service-llm-error",
    llm_not_configured:   "service-llm-error",
    llm_tier_unsupported: "service-llm-error",
    llm_refusal:          "service-llm-refusal",
    llm_refused:          "service-llm-refusal",
    invalid_output:       "service-invalid-output",
    llm_output_invalid:   "service-invalid-output",
    llm_output_truncated: "service-invalid-output",
    timeout:              "service-timeout",
    worker_lost:          "service-worker-lost",
    internal_error:       "service-internal-error",
});

const UNKNOWN_SERVICE_ERROR = "service-internal-error";

// Recorded when a started generation fails for another reason, such as a
// database error while waiting for the case text.
const UNEXPECTED_FAILURE = {
    errorCode:    "adapter-error",
    errorMessage: "The topic listing adapter failed unexpectedly.",
};

let aiAdditionsClient = defaultAiAdditionsClient;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyText(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function truncate(text, maxLength) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export async function getUiTranslations() {
    return UI_TRANSLATIONS;
}

/**
 * The request language for a case's `language_code`, by the canonical rule:
 * Spanish (`es`, `es_*`, `es-*`) is `es_CL`, anything else `en_US`. A case
 * without a language code is `es_CL`, the column default.
 */
export function normalizeCaseLanguage(languageCode) {
    const code = String(languageCode ?? "").trim();
    if (!code) {
        return "es_CL";
    }
    return /^es(?:[-_]|$)/iu.test(code) ? "es_CL" : "en_US";
}

/**
 * The `topic-listing-request/v1` for a case: the shared request envelope,
 * with no fields of its own and no optional `context`.
 */
export function buildTopicListingRequest({ caseId, title, text, languageCode, jobId }) {
    const id = String(caseId);
    const caseTitle = String(title ?? "").trim();

    return {
        schemaVersion: TOPIC_LISTING_REQUEST_SCHEMA,
        case:          {
            id,
            title:    truncate(caseTitle || `Case ${id}`, MAX_TITLE_LENGTH),
            text,
            language: normalizeCaseLanguage(languageCode),
        },
        clientContext: {
            service:       CLIENT_SERVICE,
            correlationId: String(jobId),
            caseId:        id,
        },
    };
}

/**
 * Checks a teacher edit of the listing (PUT /cases/:id/analyses/:serviceId).
 * Ids are kept, new topics are numbered after the highest id, and the
 * `generation` of the stored listing is kept (see normalizeTopicListingEdit).
 */
export async function validateCaseAnalysisDocument(document, {
    languageCode = null,
    currentDocument = null,
} = {}) {
    const result = normalizeTopicListingEdit(document, { currentDocument, languageCode });
    return result.errors
        ? { errors: result.errors }
        : { documentSchema: TOPIC_LISTING_SCHEMA, document: result.document };
}

/**
 * The error code and message recorded for a failed result. Unknown codes are
 * internal errors, and the message falls back to a generic one.
 */
export function serviceFailure(error) {
    const code = isPlainObject(error) ? error.code : null;
    const errorCode = (typeof code === "string" && Object.hasOwn(SERVICE_ERROR_CODES, code))
        ? SERVICE_ERROR_CODES[code]
        : UNKNOWN_SERVICE_ERROR;
    const message = isPlainObject(error) && isNonEmptyText(error.message)
        ? error.message.trim()
        : "Case Analyst could not list the topics of the case.";

    return { errorCode, errorMessage: truncate(message, MAX_ERROR_MESSAGE_LENGTH) };
}

// What a rejected request is recorded as: Case Analyst refused the request
// (`request-rejected`, a 4xx such as a 422 validation error) or could not be
// reached (`request-failed`: no connection, network error, timeout, 5xx).
export function requestFailure(error) {
    const statusCode = Number(error?.statusCode);

    if (statusCode >= 400 && statusCode < 500) {
        return {
            errorCode:    "request-rejected",
            errorMessage: `Case Analyst rejected the topic listing request (HTTP ${statusCode}).`,
        };
    }

    if (error?.code === "not_configured") {
        return {
            errorCode:    "request-failed",
            errorMessage: "The AI Additions connection is not configured.",
        };
    }

    return {
        errorCode:    "request-failed",
        errorMessage: Number.isInteger(statusCode) && statusCode > 0
            ? `Case Analyst could not take the topic listing request (HTTP ${statusCode}).`
            : "Case Analyst could not be reached.",
    };
}

async function failStarted({ caseAnalyses, callback, jobId, hook, errorCode, errorMessage }) {
    await caseAnalyses.fail({ jobId, errorCode, errorMessage });
    await callback({ hook, status: "failed", errorCode, error: errorMessage });
}

async function processCaseCreated({ context, callback, caseAnalyses, waitForCaseDocumentText }) {
    const analysis = await caseAnalyses.markProcessing({
        caseId: context.caseId,
        jobId:  context.jobId,
    });

    if (!analysis) {
        await callback({
            hook:   CASE_CREATED_HOOK,
            status: "skipped",
            reason: "The generation is no longer the one reserved for the case.",
        });
        return;
    }

    const failure = { caseAnalyses, callback, jobId: analysis.jobId, hook: CASE_CREATED_HOOK };

    try {
        const outcome = await waitForCaseDocumentText(context.caseId);

        if (outcome.status !== "ready") {
            await failStarted({
                ...failure,
                errorCode:    outcome.status,
                errorMessage: RENDER_FAILURES[outcome.status]
                    ?? "The case document is not available.",
            });
            return;
        }

        const text = String(outcome.text ?? "");
        if (!text.trim()) {
            await failStarted({
                ...failure,
                errorCode:    "empty-case-text",
                errorMessage: "The case document has no text to list topics from.",
            });
            return;
        }
        if (text.length > MAX_TEXT_LENGTH) {
            await failStarted({
                ...failure,
                errorCode:    "case-text-too-long",
                errorMessage: `The case text is longer than the ${MAX_TEXT_LENGTH} characters `
                    + "Case Analyst accepts.",
            });
            return;
        }

        const request = buildTopicListingRequest({
            caseId:       context.caseId,
            title:        context.title,
            text,
            languageCode: context.languageCode,
            jobId:        analysis.jobId,
        });

        let accepted;
        try {
            accepted = await aiAdditionsClient.requestJson(TOPIC_LISTINGS_PATH, {
                method:   "POST",
                basePath: CASE_ANALYST_API_BASE_PATH,
                body:     request,
            });
        } catch (error) {
            console.warn(`${LOG_PREFIX} Case Analyst did not take the topic listing `
                + `of case ${context.caseId}.`, {
                jobId:      analysis.jobId,
                statusCode: error?.statusCode ?? null,
                code:       error?.code ?? null,
                message:    error?.message ?? null,
            });
            await failStarted({ ...failure, ...requestFailure(error) });
            return;
        }

        // The job stays dispatched until the callback carries the result.
        console.info(`${LOG_PREFIX} Requested the topic listing of case ${context.caseId}.`, {
            jobId:  analysis.jobId,
            taskId: accepted?.taskId ?? null,
        });
    } catch (error) {
        // The generation started, so it is failed here rather than left
        // 'processing' until it is stale. register() reports the error.
        await caseAnalyses.fail({ jobId: analysis.jobId, ...UNEXPECTED_FAILURE })
            .catch(failError => console.warn(
                `${LOG_PREFIX} Could not record the failed generation.`,
                failError
            ));
        throw error;
    }
}

function skipCallback(callback, reason) {
    return callback({ hook: CALLBACK_RECEIVED_HOOK, status: "skipped", reason });
}

// The analysis is recorded, or the generation it belongs to was superseded
// (a newer generation, or the stale window passed): complete() and fail()
// then return null and the result is only kept in external_service_results.
async function reportRecorded(callback, recorded, outcome) {
    if (!recorded) {
        await skipCallback(callback, "The generation is no longer the current one for the case.");
        return;
    }
    await callback({ hook: CALLBACK_RECEIVED_HOOK, ...outcome });
}

async function failInvalidResult({ caseAnalyses, callback, jobId, errorMessage, error }) {
    const recorded = await caseAnalyses.fail({ jobId, errorCode: "invalid-result", errorMessage });
    await reportRecorded(callback, recorded, { status: "failed", error });
}

async function processExternalResult({ context, callback, caseAnalyses }) {
    // The registry delivers only callbacks that correlate with one of this
    // service's jobs; one without a job names no generation to record.
    const jobId = context.jobId;
    if (!jobId) {
        await skipCallback(callback, "The callback matches no topic listing request.");
        return;
    }

    if ((context.eventType ?? "result") !== "result") {
        await skipCallback(callback, `Unexpected event type ${context.eventType}.`);
        return;
    }

    const payload = context.requestPayload;
    const echoedJobId = payload?.clientContext?.correlationId;
    if (echoedJobId !== undefined && String(echoedJobId) !== String(jobId)) {
        await callback({
            hook:   CALLBACK_RECEIVED_HOOK,
            status: "failed",
            error:  "The result names another topic listing request than its callback.",
        });
        return;
    }

    const invalid = { caseAnalyses, callback, jobId };

    if (!isPlainObject(payload) || payload.schemaVersion !== TOPIC_LISTING_RESULT_SCHEMA) {
        await failInvalidResult({
            ...invalid,
            errorMessage: `The result is not a ${TOPIC_LISTING_RESULT_SCHEMA} document.`,
            error:        "Invalid result payload.",
        });
        return;
    }

    if (payload.status === "failed") {
        const failure = serviceFailure(payload.error);
        const recorded = await caseAnalyses.fail({ jobId, ...failure });
        await reportRecorded(callback, recorded, {
            status:    "failed",
            errorCode: failure.errorCode,
            error:     failure.errorMessage,
        });
        return;
    }

    if (payload.status !== "completed") {
        await failInvalidResult({
            ...invalid,
            errorMessage: "The result has an unknown status: "
                + `${String(payload.status).slice(0, 50)}.`,
            error: "Unknown result status.",
        });
        return;
    }

    // The listing is stored as sent, so it must already be one the teacher
    // can edit and save: the whole document is checked, not only what the
    // tab reads.
    const problems = checkTopicListingDocument(payload.topicListing);
    if (problems.length > 0) {
        console.warn(`${LOG_PREFIX} The topic listing of job ${jobId} is not usable.`,
            problems.slice(0, 10));
        await failInvalidResult({
            ...invalid,
            errorMessage: truncate(
                `The topic listing is not usable: ${problems[0]}`,
                MAX_ERROR_MESSAGE_LENGTH
            ),
            error: "Invalid topic listing.",
        });
        return;
    }

    const recorded = await caseAnalyses.complete({
        jobId,
        documentSchema: TOPIC_LISTING_SCHEMA,
        document:       payload.topicListing,
    });
    await reportRecorded(callback, recorded, { status: "completed", action: "recorded" });
}

export async function register({
    subscribe,
    caseAnalyses,
    aiAdditionsClient: providedAiAdditionsClient,
    topicListingDependencies = {},
}) {
    aiAdditionsClient = providedAiAdditionsClient || defaultAiAdditionsClient;
    const waitForCaseDocumentText = topicListingDependencies.waitForCaseDocumentText
        ?? defaultWaitForCaseDocumentText;

    subscribe(CASE_CREATED_HOOK, async (context, { callback }) => {
        try {
            await processCaseCreated({ context, callback, caseAnalyses, waitForCaseDocumentText });
        } catch (error) {
            await callback({
                hook:   CASE_CREATED_HOOK,
                status: "failed",
                error:  error?.message || "Unexpected topic listing error.",
            });
        }
    });

    subscribe(CALLBACK_RECEIVED_HOOK, async (context, { callback }) => {
        try {
            await processExternalResult({ context, callback, caseAnalyses });
        } catch (error) {
            await callback({
                hook:   CALLBACK_RECEIVED_HOOK,
                status: "failed",
                error:  error?.message || "Unexpected topic listing callback error.",
            });
        }
    });
}

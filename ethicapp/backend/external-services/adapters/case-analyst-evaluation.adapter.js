import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";
import {
    waitForCaseDocumentText as defaultWaitForCaseDocumentText,
} from "../../helpers/case-document-render-helper.js";

// Case evaluation from Case Analyst (#844, epic #647): how good a case is as
// discussion material, written as feedback for its author.
//
// On `case-created` the adapter starts the reserved generation, waits for the
// extracted case text and posts a `case-evaluation-request/v1` to Case
// Analyst, which answers 202 and evaluates the case asynchronously (about two
// and a half minutes). The result arrives as a `callback-received` with a
// `case-evaluation-result/v1` payload, correlated with the job id the request
// carried, and is stored as the case analysis (`case-evaluation/v1`).
//
// The evaluation is feedback, not a document the teacher edits, so the
// adapter exports no validateCaseAnalysisDocument() and edits answer 405.
//
// The contract lives in ethicapp-ai-additions,
// case-analyst/app/modules/case_evaluation/ (schemas/ and examples/).

// The Case Analyst API under the AI Additions connection's base URL (#814).
export const CASE_ANALYST_API_BASE_PATH = "/case-analyst/api/v1";
export const CASE_EVALUATIONS_PATH      = "/evaluations";

export const CASE_EVALUATION_REQUEST_SCHEMA = "case-evaluation-request/v1";
export const CASE_EVALUATION_SCHEMA         = "case-evaluation/v1";
export const CASE_EVALUATION_RESULT_SCHEMA  = "case-evaluation-result/v1";

const CASE_CREATED_HOOK      = "case-created";
const CALLBACK_RECEIVED_HOOK = "callback-received";
const CLIENT_SERVICE         = "case-analyst-evaluation";
const LOG_PREFIX             = "[case-analyst-evaluation]";

// Limits of the request envelope (case-request-envelope/v1).
const MAX_TITLE_LENGTH = 500;
const MAX_TEXT_LENGTH  = 200000;
// Stored error messages are kept short; the service's are at most 500.
const MAX_ERROR_MESSAGE_LENGTH = 500;

const LANGUAGES = Object.freeze(["es_CL", "en_US"]);

// Case Analyst does not publish translated texts yet, so this adapter
// provides them until the service does.
const UI_TRANSLATIONS = {
    es_CL: {
        label:       "Evaluación del caso",
        description: "Evalúa el caso como material de discusión y entrega retroalimentación a su autor.",
        tabTitle:    "Evaluación del caso",
    },
    en_US: {
        label:       "Case evaluation",
        description: "Evaluates the case as discussion material and gives feedback to its author.",
        tabTitle:    "Case evaluation",
    },
};

// Error messages for each outcome of the render wait other than "ready".
const RENDER_FAILURES = {
    "no-document":   "The case has no document.",
    "render-failed": "The case document could not be rendered.",
    "superseded":    "A newer document replaced the case document.",
    "timeout":       "The case document was not rendered in time.",
};

// The public error codes of a failed `case-evaluation-result/v1`, recorded
// under codes of their own: Case Analyst's `timeout` is not the render
// timeout of the case document.
export const SERVICE_ERROR_CODES = Object.freeze({
    llm_error:      "service-llm-error",
    llm_refusal:    "service-llm-refusal",
    invalid_output: "service-invalid-output",
    timeout:        "service-timeout",
    worker_lost:    "service-worker-lost",
    internal_error: "service-internal-error",
});

const UNKNOWN_SERVICE_ERROR = "service-internal-error";

// Recorded when a started generation fails for another reason, such as a
// database error while storing the result.
const UNEXPECTED_FAILURE = {
    errorCode:    "adapter-error",
    errorMessage: "The case evaluation adapter failed unexpectedly.",
};

let aiAdditionsClient = defaultAiAdditionsClient;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value) {
    return typeof value === "string";
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
 * The `case-evaluation-request/v1` for a case. EthicApp cases have no
 * pedagogical context, so the optional `context` is left out.
 */
export function buildCaseEvaluationRequest({ caseId, title, text, languageCode, jobId }) {
    const id = String(caseId);
    const caseTitle = String(title ?? "").trim();

    return {
        schemaVersion: CASE_EVALUATION_REQUEST_SCHEMA,
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

function checkEvidence(value, path, errors) {
    if (!Array.isArray(value) || !value.every(isText)) {
        errors.push(`${path} must be a list of strings.`);
    }
}

function checkCriterionResult(result, path, errors) {
    if (!isPlainObject(result)) {
        errors.push(`${path} must be an object.`);
        return;
    }
    if (!isNonEmptyText(result.criterion)) {
        errors.push(`${path}.criterion must be a non-empty string.`);
    }
    if (!isText(result.feedback)) {
        errors.push(`${path}.feedback must be a string.`);
    }
    checkEvidence(result.evidence, `${path}.evidence`, errors);
    if (!isText(result.suggestion)) {
        errors.push(`${path}.suggestion must be a string.`);
    }
}

function checkEvaluations(evaluations, errors) {
    if (!Array.isArray(evaluations) || evaluations.length === 0) {
        errors.push("evaluations must be a non-empty list.");
        return;
    }

    evaluations.forEach((evaluation, index) => {
        const path = `evaluations[${index}]`;
        if (!isPlainObject(evaluation)) {
            errors.push(`${path} must be an object.`);
            return;
        }
        if (!isNonEmptyText(evaluation.evaluator)) {
            errors.push(`${path}.evaluator must be a non-empty string.`);
        }
        if (!Array.isArray(evaluation.results) || evaluation.results.length === 0) {
            errors.push(`${path}.results must be a non-empty list.`);
            return;
        }
        evaluation.results.forEach((result, resultIndex) => {
            checkCriterionResult(result, `${path}.results[${resultIndex}]`, errors);
        });
    });
}

function checkPriorityItem(item, path, textKeys, errors) {
    if (!isPlainObject(item)) {
        errors.push(`${path} must be an object.`);
        return;
    }
    if (!Number.isInteger(item.priority)) {
        errors.push(`${path}.priority must be an integer.`);
    }
    for (const key of textKeys) {
        if (!isText(item[key])) {
            errors.push(`${path}.${key} must be a string.`);
        }
    }
    checkEvidence(item.caseEvidence, `${path}.caseEvidence`, errors);
}

function checkSynthesis(synthesis, errors) {
    if (!isPlainObject(synthesis)) {
        errors.push("synthesis must be an object.");
        return;
    }

    if (!Array.isArray(synthesis.selectedIssues)) {
        errors.push("synthesis.selectedIssues must be a list.");
    } else {
        synthesis.selectedIssues.forEach((issue, index) => {
            checkPriorityItem(issue, `synthesis.selectedIssues[${index}]`,
                ["issue", "selectionReason", "recommendation"], errors);
        });
    }

    const finalFeedback = synthesis.finalFeedback;
    if (!isPlainObject(finalFeedback)) {
        errors.push("synthesis.finalFeedback must be an object.");
        return;
    }
    if (!isText(finalFeedback.summary)) {
        errors.push("synthesis.finalFeedback.summary must be a string.");
    }
    if (!Array.isArray(finalFeedback.recommendations)) {
        errors.push("synthesis.finalFeedback.recommendations must be a list.");
    } else {
        finalFeedback.recommendations.forEach((recommendation, index) => {
            checkPriorityItem(recommendation, `synthesis.finalFeedback.recommendations[${index}]`,
                ["recommendation"], errors);
        });
    }
}

/**
 * Checks the parts of a `case-evaluation/v1` document the case view reads.
 * Case Analyst validates the whole document against its JSON Schema before
 * sending it; this only keeps a malformed callback out of `case_analyses`.
 * Returns the list of problems, empty when the document is usable.
 */
export function checkCaseEvaluationDocument(document) {
    if (!isPlainObject(document)) {
        return ["The evaluation must be an object."];
    }

    const errors = [];
    if (document.schemaVersion !== CASE_EVALUATION_SCHEMA) {
        errors.push(`schemaVersion must be ${CASE_EVALUATION_SCHEMA}.`);
    }
    if (!LANGUAGES.includes(document.language)) {
        errors.push(`language must be one of ${LANGUAGES.join(", ")}.`);
    }
    checkEvaluations(document.evaluations, errors);
    checkSynthesis(document.synthesis, errors);
    return errors;
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
        : "Case Analyst could not evaluate the case.";

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
            errorMessage: `Case Analyst rejected the evaluation request (HTTP ${statusCode}).`,
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
            ? `Case Analyst could not take the evaluation request (HTTP ${statusCode}).`
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
                errorMessage: RENDER_FAILURES[outcome.status] ?? "The case document is not available.",
            });
            return;
        }

        const text = String(outcome.text ?? "");
        if (!text.trim()) {
            await failStarted({
                ...failure,
                errorCode:    "empty-case-text",
                errorMessage: "The case document has no text to evaluate.",
            });
            return;
        }
        if (text.length > MAX_TEXT_LENGTH) {
            await failStarted({
                ...failure,
                errorCode:    "case-text-too-long",
                errorMessage: `The case text is longer than the ${MAX_TEXT_LENGTH} characters Case Analyst accepts.`,
            });
            return;
        }

        const request = buildCaseEvaluationRequest({
            caseId:       context.caseId,
            title:        context.title,
            text,
            languageCode: context.languageCode,
            jobId:        analysis.jobId,
        });

        let accepted;
        try {
            accepted = await aiAdditionsClient.requestJson(CASE_EVALUATIONS_PATH, {
                method:   "POST",
                basePath: CASE_ANALYST_API_BASE_PATH,
                body:     request,
            });
        } catch (error) {
            console.warn(`${LOG_PREFIX} Case Analyst did not take the evaluation of case ${context.caseId}.`, {
                jobId:      analysis.jobId,
                statusCode: error?.statusCode ?? null,
                code:       error?.code ?? null,
                message:    error?.message ?? null,
            });
            await failStarted({ ...failure, ...requestFailure(error) });
            return;
        }

        // The job stays dispatched until the callback carries the result.
        console.info(`${LOG_PREFIX} Requested the evaluation of case ${context.caseId}.`, {
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

async function processExternalResult({ context, callback, caseAnalyses }) {
    // The registry delivers only callbacks that correlate with one of this
    // service's jobs; one without a job names no generation to record.
    const jobId = context.jobId;
    if (!jobId) {
        await skipCallback(callback, "The callback matches no evaluation request.");
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
            error:  "The result names another evaluation request than its callback.",
        });
        return;
    }

    if (!isPlainObject(payload) || payload.schemaVersion !== CASE_EVALUATION_RESULT_SCHEMA) {
        const recorded = await caseAnalyses.fail({
            jobId,
            errorCode:    "invalid-result",
            errorMessage: `The result is not a ${CASE_EVALUATION_RESULT_SCHEMA} document.`,
        });
        await reportRecorded(callback, recorded, { status: "failed", error: "Invalid result payload." });
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
        const recorded = await caseAnalyses.fail({
            jobId,
            errorCode:    "invalid-result",
            errorMessage: `The result has an unknown status: ${String(payload.status).slice(0, 50)}.`,
        });
        await reportRecorded(callback, recorded, { status: "failed", error: "Unknown result status." });
        return;
    }

    const problems = checkCaseEvaluationDocument(payload.evaluation);
    if (problems.length > 0) {
        console.warn(`${LOG_PREFIX} The evaluation of job ${jobId} is not usable.`, problems.slice(0, 10));
        const recorded = await caseAnalyses.fail({
            jobId,
            errorCode:    "invalid-result",
            errorMessage: truncate(`The evaluation is not usable: ${problems[0]}`, MAX_ERROR_MESSAGE_LENGTH),
        });
        await reportRecorded(callback, recorded, { status: "failed", error: "Invalid evaluation." });
        return;
    }

    const recorded = await caseAnalyses.complete({
        jobId,
        documentSchema: CASE_EVALUATION_SCHEMA,
        document:       payload.evaluation,
    });
    await reportRecorded(callback, recorded, {
        status: "completed",
        action: "recorded",
        taskId: isText(payload.taskId) ? payload.taskId : null,
    });
}

export async function register({
    subscribe,
    caseAnalyses,
    aiAdditionsClient: providedAiAdditionsClient,
    caseEvaluationDependencies = {},
}) {
    aiAdditionsClient = providedAiAdditionsClient || defaultAiAdditionsClient;
    const waitForCaseDocumentText = caseEvaluationDependencies.waitForCaseDocumentText
        ?? defaultWaitForCaseDocumentText;

    subscribe(CASE_CREATED_HOOK, async (context, { callback }) => {
        try {
            await processCaseCreated({ context, callback, caseAnalyses, waitForCaseDocumentText });
        } catch (error) {
            await callback({
                hook:   CASE_CREATED_HOOK,
                status: "failed",
                error:  error?.message || "Unexpected case evaluation error.",
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
                error:  error?.message || "Unexpected case evaluation callback error.",
            });
        }
    });
}

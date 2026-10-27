import { hashAnalysisInput } from "../../helpers/analysis-input-hash.js";
import { getCaseAnalysis } from "../../helpers/case-analyses-helper.js";
import { waitForCaseDocumentText } from "../../helpers/case-document-render-helper.js";
import {
    ARGUMENTATION_TUTOR_SERVICE_ID,
    selectTutorQuestions,
} from "../../helpers/design-tutor-questions.js";
import {
    CLAIM_TYPOLOGY_SCHEMA,
    CLAIM_TYPOLOGY_SERVICE_ID,
    EVIDENCE_INVENTORY_SCHEMA,
    EVIDENCE_INVENTORY_SERVICE_ID,
    loadEvidenceInventory,
} from "../../helpers/tutor-claim-typology.js";
import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";

// Claim typology from Case Analyst (#849, epic #846): the plausible types of
// answer to each question of the phases that use the Argumentation Tutor. One
// job covers every selected question of a design, and its claim-typology/v1
// document is stored as the design's analysis by this service. The Case
// Analyst contract is ethicapp-ai-additions#192
// (case-analyst/app/modules/claim_typology/).
//
// - design-saved: starts the reserved generation, waits for the case text and
//   sends one POST /claim-typologies. The job stays dispatched until Case
//   Analyst posts its result.
// - callback-received: stores the completed document, or records the failure.

// The service id and the stored schemas are shared with the Argumentation
// Tutor adapter, which passes each question's typology to the tutor (#850).
// The case's evidence inventory (#652) is a case analysis; when the case has
// one, the request carries it so that claim types cite its facts (EV#).
export {
    CLAIM_TYPOLOGY_SCHEMA,
    CLAIM_TYPOLOGY_SERVICE_ID,
    EVIDENCE_INVENTORY_SCHEMA,
    EVIDENCE_INVENTORY_SERVICE_ID,
    loadEvidenceInventory,
};
export const CLAIM_TYPOLOGY_REQUEST_SCHEMA = "claim-typology-request/v1";
export const CLAIM_TYPOLOGY_RESULT_SCHEMA = "claim-typology-result/v1";

// claim-typology-request/v1 accepts 1 to 30 questions. A design with more
// tutor questions gets a typology for its first 30, in design order.
export const MAX_CLAIM_TYPOLOGY_QUESTIONS = 30;

export const CASE_ANALYST_API_BASE_PATH = "/case-analyst/api/v1";
const CLAIM_TYPOLOGIES_PATH = "/claim-typologies";

// Limits of the request schema (case-request-envelope/v1 and
// claim-typology-request/v1).
const MAX_CASE_TITLE_LENGTH    = 500;
const MAX_CASE_TEXT_LENGTH     = 200000;
const MAX_QUESTION_TEXT_LENGTH = 5000;

const DESIGN_SAVED_HOOK      = "design-saved";
const CALLBACK_RECEIVED_HOOK = "callback-received";

// Case Analyst does not publish translated texts yet, so this adapter
// provides them until the service does.
const UI_TRANSLATIONS = {
    es_CL: {
        label:       "Tipología de respuestas",
        description: "Propone, a partir del caso, los tipos de respuesta plausibles a cada "
            + "pregunta de las fases que usan el tutor de argumentación.",
        tabTitle: "Tipología de respuestas",
    },
    en_US: {
        label:       "Claim typology",
        description: "Drafts, from the case, the plausible types of answer to each question of the "
            + "phases that use the Argumentation Tutor.",
        tabTitle: "Claim typology",
    },
};

// Error codes recorded on the analysis (design_analyses.error_code), from the
// adapters' shared vocabulary (README, "Error codes"). The codes of
// waitForCaseDocumentText() (no-document, render-failed, superseded, timeout)
// are recorded as they are, and a failed result as `service-<code>`
// (SERVICE_ERROR_CODES).
export const CLAIM_TYPOLOGY_ERRORS = Object.freeze({
    EMPTY_CASE_TEXT:    "empty-case-text",
    CASE_TEXT_TOO_LONG: "case-text-too-long",
    REQUEST_REJECTED:   "request-rejected",
    REQUEST_FAILED:     "request-failed",
    INVALID_RESULT:     "invalid-result",
    ADAPTER_ERROR:      "adapter-error",
});

// The messages recorded with each code, by code.
const ERROR_MESSAGES = Object.freeze({
    "empty-case-text":    "The case document has no text.",
    "case-text-too-long": `The case text exceeds ${MAX_CASE_TEXT_LENGTH} characters.`,
    "invalid-result":     "Case Analyst sent a result that is not a claim typology.",
    "adapter-error":      "The claim typology adapter failed unexpectedly.",
});

// The public error codes of a failed `claim-typology-result/v1`, recorded
// under codes of their own: Case Analyst's `timeout` is not the render
// timeout of the case document. The result schema also names the core codes
// behind them (llm_refused, llm_output_invalid...), which map to the same
// public code. Unknown codes are internal errors.
export const SERVICE_ERROR_CODES = Object.freeze({
    llm_error:            "service-llm-error",
    llm_request_failed:   "service-llm-error",
    llm_not_configured:   "service-llm-error",
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

const CASE_TEXT_ERRORS = Object.freeze({
    "no-document":   "The case has no document to analyse.",
    "render-failed": "The case document could not be processed.",
    "superseded":    "A newer document replaced the case document.",
    "timeout":       "The case document was not processed in time.",
});

let aiAdditionsClient = defaultAiAdditionsClient;
let waitForCaseText = waitForCaseDocumentText;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function failure(errorCode, errorMessage = ERROR_MESSAGES[errorCode]) {
    return { errorCode, errorMessage };
}

export async function getUiTranslations() {
    return UI_TRANSLATIONS;
}

/**
 * The language Case Analyst writes in, from the case's language code, by the
 * repository's locale rule: `es` and `es_*` are `es_CL`, anything else is
 * `en_US`.
 */
export function caseAnalystLanguage(languageCode) {
    return /^es(?:[_-]|$)/iu.test(String(languageCode ?? "").trim()) ? "es_CL" : "en_US";
}

// Whether the current AI service policy allows the Argumentation Tutor (epic
// #846: the typology runs only where the tutor may run). The registry is
// imported here because it imports this adapter.
async function isTutorUsable() {
    const { default: registry } = await import("../../services/external-services.service.js");
    return registry.isServiceUsable(ARGUMENTATION_TUTOR_SERVICE_ID);
}

/**
 * Applies to designs with a case and at least one tutor question (the
 * semantic differential questions of the phases that enable
 * argumentation-tutor-system), while the current policy allows the tutor.
 *
 * Questions keep their positional ids (`p<phase>-q<question>`); a design with
 * more than MAX_CLAIM_TYPOLOGY_QUESTIONS tutor questions sends the first ones
 * and logs a warning. The hash covers the case language, the case PDF hash,
 * each question's id and text hash, and the evidence inventory's content
 * hash. Design and case ids and the case title are left out, so a copy of the
 * design keeps the same hash.
 *
 * @param {{design: Object, designCase: Object|null}} args
 * @param {Object} [dependencies] - Overrides for tests.
 * @returns {Promise<{input: Object, hash: string}|null>}
 */
export async function designAnalysisInput(
    { design, designCase },
    { isTutorAllowed = isTutorUsable, getAnalysis = getCaseAnalysis } = {}
) {
    if (!designCase) {
        return null;
    }

    const selected = selectTutorQuestions(design);
    if (selected.length === 0) {
        return null;
    }

    if (!await isTutorAllowed()) {
        return null;
    }

    if (selected.length > MAX_CLAIM_TYPOLOGY_QUESTIONS) {
        console.warn(
            `[${CLAIM_TYPOLOGY_SERVICE_ID}] The design has ${selected.length} tutor questions; `
            + `the claim typology covers the first ${MAX_CLAIM_TYPOLOGY_QUESTIONS}.`
        );
    }
    const questions = selected.slice(0, MAX_CLAIM_TYPOLOGY_QUESTIONS);

    const inventory = await loadEvidenceInventory(designCase.id, { getAnalysis });
    const caseInput = {
        language:    caseAnalystLanguage(designCase.languageCode),
        contentHash: designCase.contentHash ?? null,
    };

    return {
        input: {
            case:              { ...caseInput, title: designCase.title ?? null },
            questions,
            evidenceInventory: inventory?.document ?? null,
        },
        hash: hashAnalysisInput({
            case:              caseInput,
            questions:         questions.map(({ id, textHash }) => ({ id, textHash })),
            evidenceInventory: inventory?.hash ?? null,
        }),
    };
}

function caseTitle(title, caseId) {
    const text = typeof title === "string" ? title.trim() : "";
    return (text || `Case ${caseId}`).slice(0, MAX_CASE_TITLE_LENGTH);
}

/**
 * The claim-typology-request/v1 body. `phaseId` is the question's phase
 * number (1-based, as the positional id). `clientContext` carries
 * `questionTextHashes`, the text hash of each question by id: Case Analyst
 * returns the clientContext unchanged, and the stored typologies record the
 * hash of the text they answer (see annotateTypology()).
 *
 * @param {Object} args
 * @param {number} args.designId
 * @param {number} args.caseId
 * @param {string} args.jobId - The generation's job id, the callback correlation id.
 * @param {Object} args.input - The analysis input from designAnalysisInput().
 * @param {string} args.caseText
 */
export function buildClaimTypologyRequest({ designId, caseId, jobId, input, caseText }) {
    const questions = Array.isArray(input?.questions) ? input.questions : [];

    const request = {
        schemaVersion: CLAIM_TYPOLOGY_REQUEST_SCHEMA,
        case:          {
            id:       String(caseId),
            title:    caseTitle(input?.case?.title, caseId),
            text:     caseText,
            language: input?.case?.language ?? "en_US",
        },
        questions: questions.map(question => ({
            id:      question.id,
            phaseId: question.phaseNumber,
            text:    question.text.slice(0, MAX_QUESTION_TEXT_LENGTH),
        })),
        clientContext: {
            service:            CLAIM_TYPOLOGY_SERVICE_ID,
            correlationId:      String(jobId),
            designId:           String(designId),
            caseId:             String(caseId),
            questionTextHashes: Object.fromEntries(
                questions.map(question => [question.id, question.textHash])
            ),
        },
    };

    if (input?.evidenceInventory) {
        request.evidenceInventory = input.evidenceInventory;
    }

    return request;
}

/**
 * Why the request could not be sent: Case Analyst refused it
 * (`request-rejected`, a 4xx such as a 422 validation error) or could not be
 * reached (`request-failed`: no AI Additions connection, a network error, a
 * timeout or a 5xx).
 */
export function requestFailure(error) {
    const statusCode = Number(error?.statusCode);

    if (statusCode >= 400 && statusCode < 500) {
        return failure(
            CLAIM_TYPOLOGY_ERRORS.REQUEST_REJECTED,
            `Case Analyst rejected the claim typology request (HTTP ${statusCode}).`
        );
    }

    if (error?.code === "not_configured") {
        return failure(
            CLAIM_TYPOLOGY_ERRORS.REQUEST_FAILED,
            "The AI Additions connection is not configured."
        );
    }

    return failure(
        CLAIM_TYPOLOGY_ERRORS.REQUEST_FAILED,
        Number.isInteger(statusCode) && statusCode > 0
            ? `Case Analyst could not take the claim typology request (HTTP ${statusCode}).`
            : "Case Analyst could not be reached."
    );
}

// The case text, or the analysis error that explains why there is none.
async function readCaseText(caseId) {
    const result = await waitForCaseText(caseId);
    if (result?.status !== "ready") {
        const code = Object.hasOwn(CASE_TEXT_ERRORS, result?.status)
            ? result.status
            : "no-document";
        return { error: failure(code, CASE_TEXT_ERRORS[code]) };
    }

    const text = typeof result.text === "string" ? result.text.trim() : "";
    if (!text) {
        return { error: failure(CLAIM_TYPOLOGY_ERRORS.EMPTY_CASE_TEXT) };
    }
    if (text.length > MAX_CASE_TEXT_LENGTH) {
        return { error: failure(CLAIM_TYPOLOGY_ERRORS.CASE_TEXT_TOO_LONG) };
    }

    return { text };
}

async function failGeneration({ designAnalyses, callback, jobId, error }) {
    await designAnalyses.fail({ jobId, ...error });
    await callback({
        hook:      DESIGN_SAVED_HOOK,
        status:    "failed",
        errorCode: error.errorCode,
        error:     error.errorMessage,
    });
}

async function processDesignSaved({ context, callback, designAnalyses }) {
    const analysis = await designAnalyses.markProcessing({
        designId: context.designId,
        jobId:    context.jobId,
    });

    if (!analysis) {
        await callback({
            hook:   DESIGN_SAVED_HOOK,
            status: "skipped",
            reason: "The generation is no longer the one reserved for the design.",
        });
        return;
    }

    const jobId = analysis.jobId;
    try {
        const input = context.analysisInput;
        const caseId = toPositiveInteger(context.caseId);
        if (!caseId || !Array.isArray(input?.questions) || input.questions.length === 0) {
            await failGeneration({
                designAnalyses, callback, jobId,
                error: failure(
                    CLAIM_TYPOLOGY_ERRORS.ADAPTER_ERROR,
                    "The generation carries no analysis input."
                ),
            });
            return;
        }

        const caseText = await readCaseText(caseId);
        if (caseText.error) {
            await failGeneration({ designAnalyses, callback, jobId, error: caseText.error });
            return;
        }

        const request = buildClaimTypologyRequest({
            designId: context.designId,
            caseId,
            jobId,
            input,
            caseText: caseText.text,
        });

        let response;
        try {
            response = await aiAdditionsClient.requestJson(CLAIM_TYPOLOGIES_PATH, {
                method:   "POST",
                basePath: CASE_ANALYST_API_BASE_PATH,
                body:     request,
            });
        } catch (error) {
            console.warn(
                `[${CLAIM_TYPOLOGY_SERVICE_ID}] Could not request the claim typology of design `
                + `${context.designId}.`,
                { statusCode: error?.statusCode ?? null, responseBody: error?.responseBody ?? null }
            );
            await failGeneration({ designAnalyses, callback, jobId, error: requestFailure(error) });
            return;
        }

        // The job stays dispatched: the callback-received handler completes it.
        console.info(
            `[${CLAIM_TYPOLOGY_SERVICE_ID}] Requested the claim typology of design `
            + `${context.designId}.`,
            {
                jobId,
                taskId:        response?.taskId ?? null,
                questions:     request.questions.length,
                evidenceFacts: request.evidenceInventory?.facts?.length ?? 0,
            }
        );
    } catch (error) {
        // The generation started, so it is failed here rather than left
        // 'processing' until it is stale. register() reports the error.
        await designAnalyses.fail({ jobId, ...failure(CLAIM_TYPOLOGY_ERRORS.ADAPTER_ERROR) })
            .catch(failError => console.warn(
                `[${CLAIM_TYPOLOGY_SERVICE_ID}] Could not record the failed generation.`,
                failError
            ));
        throw error;
    }
}

function isClaimTypology(document) {
    return isPlainObject(document)
        && document.schemaVersion === CLAIM_TYPOLOGY_SCHEMA
        && Array.isArray(document.typologies)
        && document.typologies.every(typology => isPlainObject(typology)
            && typeof typology.questionId === "string"
            && Array.isArray(typology.types));
}

/**
 * A typology as stored: the claim-typology/v1 typology plus
 * `questionTextHash`, the hash of the question text it answers, from the
 * request's `clientContext.questionTextHashes`. The design view compares it
 * with the current question text to tell when a typology is out of date. It
 * is null when the result does not carry it.
 */
export function annotateTypology(typology, questionTextHashes) {
    const hash = isPlainObject(questionTextHashes) ? questionTextHashes[typology.questionId] : null;
    return {
        ...typology,
        questionTextHash: typeof hash === "string" && hash ? hash : null,
    };
}

// The document stored for a completed result.
export function claimTypologyDocument(result) {
    const document = result.claimTypology;
    const questionTextHashes = result.clientContext?.questionTextHashes;
    return {
        ...document,
        typologies: document.typologies.map(
            typology => annotateTypology(typology, questionTextHashes)
        ),
    };
}

/**
 * The error code and message recorded for a failed result: `service-<code>`
 * with Case Analyst's sanitized message. An unknown code is an internal error,
 * and its code is kept in the message for diagnosis.
 */
export function serviceFailure(error) {
    const code = isPlainObject(error) && typeof error.code === "string" ? error.code : null;
    const known = code !== null && Object.hasOwn(SERVICE_ERROR_CODES, code);
    const reported = isPlainObject(error) && typeof error.message === "string"
        ? error.message.trim()
        : "";
    const message = reported || "Case Analyst could not generate the claim typology.";

    return failure(
        known ? SERVICE_ERROR_CODES[code] : UNKNOWN_SERVICE_ERROR,
        known || code === null ? message : `${message} (${code})`
    );
}

async function processExternalResult({ context, callback, designAnalyses }) {
    const jobId = context.jobId;
    if (!jobId) {
        await callback({
            hook:   CALLBACK_RECEIVED_HOOK,
            status: "skipped",
            reason: "The callback matches no claim typology job.",
        });
        return;
    }

    const result = isPlainObject(context.requestPayload) ? context.requestPayload : {};
    const completed = result.schemaVersion === CLAIM_TYPOLOGY_RESULT_SCHEMA
        && result.status === "completed"
        && isClaimTypology(result.claimTypology);

    if (!completed) {
        const failed = result.schemaVersion === CLAIM_TYPOLOGY_RESULT_SCHEMA
            && result.status === "failed";
        const error = failed
            ? serviceFailure(result.error)
            : failure(CLAIM_TYPOLOGY_ERRORS.INVALID_RESULT);
        const stored = await designAnalyses.fail({ jobId, ...error });
        await callback({
            hook:      CALLBACK_RECEIVED_HOOK,
            status:    stored ? "failed" : "skipped",
            errorCode: error.errorCode,
            error:     error.errorMessage,
        });
        return;
    }

    const stored = await designAnalyses.complete({
        jobId,
        documentSchema: CLAIM_TYPOLOGY_SCHEMA,
        document:       claimTypologyDocument(result),
    });
    await callback({
        hook:       CALLBACK_RECEIVED_HOOK,
        status:     stored ? "completed" : "skipped",
        action:     stored ? "stored" : "superseded",
        typologies: result.claimTypology.typologies.length,
    });
}

/**
 * @param {Object} args - See "Adapter registration" in the README.
 * @param {Object} [args.claimTypologyDependencies] - Test-only overrides:
 *     `waitForCaseText`.
 */
export async function register({
    subscribe,
    designAnalyses,
    aiAdditionsClient: providedAiAdditionsClient,
    claimTypologyDependencies = {},
}) {
    aiAdditionsClient = providedAiAdditionsClient || defaultAiAdditionsClient;
    waitForCaseText = claimTypologyDependencies.waitForCaseText || waitForCaseDocumentText;

    subscribe(DESIGN_SAVED_HOOK, async (context, { callback }) => {
        try {
            await processDesignSaved({ context, callback, designAnalyses });
        } catch (error) {
            await callback({
                hook:   DESIGN_SAVED_HOOK,
                status: "failed",
                error:  error?.message || "Unexpected claim typology error.",
            });
        }
    });

    subscribe(CALLBACK_RECEIVED_HOOK, async (context, { callback }) => {
        try {
            await processExternalResult({ context, callback, designAnalyses });
        } catch (error) {
            await callback({
                hook:   CALLBACK_RECEIVED_HOOK,
                status: "failed",
                error:  error?.message || "Unexpected claim typology callback error.",
            });
        }
    });
}

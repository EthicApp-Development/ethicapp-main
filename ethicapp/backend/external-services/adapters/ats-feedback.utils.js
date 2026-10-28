import { plainTextOf } from "../../helpers/rich-text-helper.js";
import { ARGUMENTATION_TUTOR_SERVICE_ID } from "../../helpers/tutor-mode.js";

// The tutor's catalog id, which design phases enable.
export { ARGUMENTATION_TUTOR_SERVICE_ID };

// The texts teachers read about this service (#723), available even when the
// tutor does not respond (#757).
const UI_TRANSLATIONS = {
    es_CL: {
        label:       "Tutor de argumentación",
        description: "Analiza los argumentos de cada estudiante y le entrega retroalimentación.",
    },
    en_US: {
        label:       "Argumentation tutor",
        description: "Analyzes each student's arguments and gives them feedback.",
    },
};

export async function getUiTranslations() {
    return UI_TRANSLATIONS;
}

export function buildArgumentClientContext(context, groupId) {
    return {
        service:       "ethicapp",
        correlationId: context.correlationId ?? null,
        sessionId:     context.sessionId,
        phaseId:       context.phaseId,
        questionId:    context.questionId,
        groupId:       Number.isInteger(groupId) ? groupId : null,
    };
}

function normalizeText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value).trim();
    return text.length > 0 ? text : "";
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

function normalizeCriteriaFromAts(parsedResult) {
    const claimScore = Number(parsedResult?.claim);
    const evidenceScore = Number(parsedResult?.evidence);
    const warrantScore = Number(parsedResult?.warrant);
    const qualifierScore = Number(parsedResult?.qualifier);

    const claimText = claimScore === 1
        ? "In favor"
        : claimScore === -1
            ? "Against"
            : "Neutral";

    return [
        {
            key:   "claim",
            label: "Claim",
            score: Number.isFinite(claimScore) ? claimScore : null,
            value: Number.isFinite(claimScore) ? `${claimText} (${claimScore})` : "Not available",
        },
        {
            key:   "evidence",
            label: "Evidence",
            score: Number.isFinite(evidenceScore) ? evidenceScore : null,
            value: Number.isFinite(evidenceScore) ? `${evidenceScore}/3` : "Not available",
        },
        {
            key:   "warrant",
            label: "Warrant",
            score: Number.isFinite(warrantScore) ? warrantScore : null,
            value: Number.isFinite(warrantScore) ? `${warrantScore}/3` : "Not available",
        },
        {
            key:   "qualifier",
            label: "Qualifier",
            score: Number.isFinite(qualifierScore) ? qualifierScore : null,
            value: Number.isFinite(qualifierScore) ? `${qualifierScore}/3` : "Not available",
        },
    ];
}

function normalizeBulletsFromAts(parsedResult) {
    const bullets = Array.isArray(parsedResult?.analysis_bullets) ? parsedResult.analysis_bullets : [];

    const normalized = bullets
        .map(item => normalizeText(item?.content))
        .filter(Boolean)
        .slice(0, 5);

    if (normalized.length > 0) {
        return normalized;
    }

    const analysisText = normalizeText(parsedResult?.analysis);
    if (analysisText) {
        return [analysisText];
    }

    return ["The argument was processed successfully by the external tutor."];
}

function normalizeScore(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function extractComparisonData(parsedResult, submissionMeta = {}) {
    const initialScores = parsedResult?.initial_scores && typeof parsedResult.initial_scores === "object"
        ? parsedResult.initial_scores
        : null;
    const revisedScores = parsedResult?.revised_scores && typeof parsedResult.revised_scores === "object"
        ? parsedResult.revised_scores
        : null;

    if (!initialScores || !revisedScores) {
        return null;
    }

    const improvementsSource = parsedResult?.improvements && typeof parsedResult.improvements === "object"
        ? parsedResult.improvements
        : {};

    const normalizePair = (key) => {
        const initial = normalizeScore(initialScores[key]);
        const revised = normalizeScore(revisedScores[key]);
        const improvement = normalizeScore(improvementsSource[key]);
        return {
            initial,
            revised,
            delta: improvement ?? (
                Number.isFinite(initial) && Number.isFinite(revised)
                    ? revised - initial
                    : null
            ),
        };
    };

    return {
        initialArgument: normalizeText(
            submissionMeta?.initialArgumentPreview
            || parsedResult?.original_argument
            || parsedResult?.initial_argument
        ),
        revisedArgument: normalizeText(
            submissionMeta?.revisedArgumentPreview
            || parsedResult?.revised_argument
        ),
        scores: {
            claim:     normalizePair("claim"),
            evidence:  normalizePair("evidence"),
            warrant:   normalizePair("warrant"),
            qualifier: normalizePair("qualifier"),
        },
    };
}

export function buildFeedbackPayloadFromAtsStatus(statusResponse, context, submissionMeta = {}) {
    const rawMessage = statusResponse?.message;
    const parsedResult = typeof rawMessage === "string" ? safeJsonParse(rawMessage) : rawMessage;

    const criteria = normalizeCriteriaFromAts(parsedResult);
    const bullets = normalizeBulletsFromAts(parsedResult);
    const summary = normalizeText(parsedResult?.analysis) || "Argument feedback is now available.";
    const comparison = extractComparisonData(parsedResult, submissionMeta);
    const mode = comparison || submissionMeta?.mode === "compare" ? "comparison" : "analysis";
    const argumentPreview = normalizeText(
        submissionMeta?.revisedArgumentPreview
        || statusResponse?.submitted_argument
        || parsedResult?.original_argument
        || parsedResult?.revised_argument
        || submissionMeta?.initialArgumentPreview
    );

    return {
        version: "1",
        source:  ARGUMENTATION_TUTOR_SERVICE_ID,
        title:   "Argument Tutor Feedback",
        summary,
        mode,
        criteria,
        bullets,
        argumentPreview,
        comparison,
        meta:    {
            sessionId:  context.sessionId,
            phaseId:    context.phaseId,
            questionId: context.questionId,
            userId:     context.userId,
        },
    };
}

export function buildFeedbackPayloadFromExternalResult(requestPayload, fallbackContext) {
    const payloadRoot = requestPayload && typeof requestPayload === "object" ? requestPayload : {};
    const sourcePayload = payloadRoot?.payload?.feedback || payloadRoot?.payload || payloadRoot;
    const input = sourcePayload && typeof sourcePayload === "object" ? sourcePayload : {};

    const criteria = Array.isArray(input.criteria) ? input.criteria : [];
    const bullets = Array.isArray(input.bullets) ? input.bullets : [];
    const mode = normalizeText(input.mode) || "analysis";
    const comparison = input?.comparison && typeof input.comparison === "object" ? input.comparison : null;

    return {
        version:  "1",
        source:   ARGUMENTATION_TUTOR_SERVICE_ID,
        title:    normalizeText(input.title) || "Argument Tutor Feedback",
        summary:  normalizeText(input.summary) || normalizeText(payloadRoot.message) || "Argument feedback is now available.",
        mode,
        criteria: criteria
            .map(item => ({
                key:   normalizeText(item?.key) || normalizeText(item?.label).toLowerCase().replace(/\s+/gu, "-"),
                label: normalizeText(item?.label) || "Criterion",
                score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
                value: normalizeText(item?.value) || "Not available",
            }))
            .filter(item => item.label && item.value)
            .slice(0, 6),
        bullets: bullets
            .map(item => normalizeText(item))
            .filter(Boolean)
            .slice(0, 6),
        argumentPreview: normalizeText(input.argumentPreview || input.submitted_argument),
        comparison,
        meta:            {
            sessionId:  Number(payloadRoot.sessionId) || fallbackContext?.sessionId || null,
            phaseId:    Number(payloadRoot.phaseId) || fallbackContext?.phaseId || null,
            questionId: Number(payloadRoot.questionId) || fallbackContext?.questionId || null,
            userId:     Number(payloadRoot.userId) || fallbackContext?.userId || null,
        },
    };
}

/** The phase's instructions as the tutor receives them: plain text (#768). */
export function phaseInstructionsText(phaseDesign) {
    const { instructions, instructionsContentType } = phaseDesign ?? {};
    return normalizeText(plainTextOf(instructions, instructionsContentType));
}

/** The phase's first non-empty question, as plain text (#768), or "". */
export function questionTextFromPhaseDesign(phaseDesign) {
    const questions = Array.isArray(phaseDesign?.questions) ? phaseDesign.questions : [];
    for (const question of questions) {
        const questionText = normalizeText(
            plainTextOf(question?.q_text, question?.q_text_content_type)
        );
        if (questionText) {
            return questionText;
        }
    }
    return "";
}

/** A semantic differential row's question (`differential.title`), as plain text (#768). */
export function differentialQuestionText(row) {
    return normalizeText(plainTextOf(row?.title, row?.title_content_type));
}

/**
 * The body of POST /sessions (#736). The only setting sent is the configured
 * `llm_tier` (#734); the deprecated `model` is not sent, and new designs are
 * not offered it (#733). An unset tier takes the tutor's default. In the
 * enhanced mode (#865) the session input `case_context`
 * (tutor-case-context/v1, ethicapp-ai-additions#209) carries the case's
 * evidence inventory and the question's claim typology. The deprecated
 * top-level `claim_typology` is never sent: the tutor refuses it together
 * with `case_context`, and together with `evaluation_mode`.
 *
 * `evaluationMode` (#870, ethicapp-ai-additions#211) is the mode the phase
 * requests, decided by helpers/tutor-mode.js and given only when the tutor's
 * descriptor declares the field; null leaves `evaluation_mode` out. The
 * stored configuration's own `evaluation_mode` is never copied as is.
 */
export function buildAtsSessionPayload(
    metadata,
    serviceConfiguration = {},
    caseContext = null,
    evaluationMode = null
) {
    const body = {
        case_id:    metadata.caseId,
        case_title: metadata.caseTitle,
        case_text:  metadata.caseText,
        question:   metadata.question,
    };

    const llmTier = normalizeText(serviceConfiguration?.llm_tier);
    if (llmTier) {
        body.llm_tier = llmTier;
    }
    if (evaluationMode) {
        body.evaluation_mode = evaluationMode;
    }
    if (caseContext) {
        body.case_context = caseContext;
    }
    return body;
}

// The outcomes of a case context offered to the tutor (#865).
export const CASE_CONTEXT_OUTCOMES = Object.freeze({
    // The tutor created the session in the enhanced mode.
    USED:        "used",
    // The tutor answered 400 about it; the session was created without it.
    REJECTED:    "rejected",
    // The tutor accepted it but created the session in the basic mode.
    DOWNGRADED:  "downgraded",
    // The answer has no `mode`: a tutor that predates #209 ignored it.
    UNSUPPORTED: "unsupported",
});

const TUTOR_SESSION_MODES = new Set(["enhanced", "basic"]);

// How the tutor names the context when it refuses one: `400 {"error":
// "Invalid case context", "errors": [...]}` (ethicapp-ai-additions#209).
const CASE_CONTEXT_NAME = /case[ _]context/iu;

/**
 * Which optional part of a session body the tutor refused with a 400, so it
 * can be left out: `case_context` when the error names it, or when it is the
 * only optional part sent, otherwise `llm_tier`. null when the body has no
 * optional part left.
 */
function rejectedOptionalField(error, body) {
    const named = CASE_CONTEXT_NAME.test(JSON.stringify(error?.responseBody ?? null));
    if (body.case_context && (named || !body.llm_tier)) {
        return "case_context";
    }
    return body.llm_tier ? "llm_tier" : null;
}

function caseContextOutcome(response, rejection) {
    if (rejection !== undefined) {
        return CASE_CONTEXT_OUTCOMES.REJECTED;
    }
    if (!TUTOR_SESSION_MODES.has(response?.mode)) {
        return CASE_CONTEXT_OUTCOMES.UNSUPPORTED;
    }
    return response.mode === "enhanced"
        ? CASE_CONTEXT_OUTCOMES.USED
        : CASE_CONTEXT_OUTCOMES.DOWNGRADED;
}

/**
 * Creates a tutor session and returns `{ sessionId, creation }`, where
 * `creation` is the tutor's lifecycle report for #737: `{ llmTier, model,
 * warnings, degraded, configurationRejected }`. The tutor answers 400 when a
 * configured value fails its format rules; the session is then created once
 * more with the tutor's defaults and `configurationRejected` says so.
 *
 * When a case context is offered (#865), `creation.caseContext` says what
 * became of it (CASE_CONTEXT_OUTCOMES). A rejected context is dropped and the
 * session created again without it; `caseContextRejection` holds the
 * tutor's answer. `creation.tutorMode` is the mode the tutor reports
 * (`enhanced` or `basic`), and `tutorModeMissing` the parts it says are
 * missing, when it reports them.
 *
 * `evaluationMode` is sent as `evaluation_mode` (#870) and kept when the
 * configured settings are rejected: it is the study condition the teacher
 * chose, not a tutor default. `creation.tutorRequestedMode` is the
 * `requestedMode` the tutor reports back, when it reports one.
 *
 * @param {(body: object) => Promise<object>} request POST /sessions
 */
export async function createAtsSession({
    metadata,
    serviceConfiguration = {},
    caseContext = null,
    evaluationMode = null,
    request,
}) {
    let configuration = serviceConfiguration;
    let context = caseContext;
    let configurationRejected = false;
    let rejection = null;
    let caseContextRejection;
    let response;

    for (;;) {
        const body = buildAtsSessionPayload(metadata, configuration, context, evaluationMode);
        try {
            response = await request(body);
            break;
        } catch (error) {
            const field = Number(error?.statusCode) === 400
                ? rejectedOptionalField(error, body)
                : null;
            if (!field) {
                throw error;
            }

            if (field === "case_context") {
                context = null;
                caseContextRejection = error.responseBody ?? null;
                continue;
            }

            console.warn("[ats-feedback] The tutor rejected the configured settings; "
                + "creating the session with its defaults.", error.responseBody ?? error);
            configuration = {};
            configurationRejected = true;
            rejection = error.responseBody ?? null;
        }
    }

    const sessionId = normalizeText(response?.session_id);
    if (!sessionId) {
        throw new Error("ATS did not return a session_id.");
    }

    const creation = {
        llmTier:  response?.llm_tier ?? null,
        model:    response?.model ?? null,
        warnings: Array.isArray(response?.warnings) ? response.warnings : [],
        degraded: response?.degraded === true,
        configurationRejected,
        ...(configurationRejected ? { rejection } : {}),
    };

    if (TUTOR_SESSION_MODES.has(response?.mode)) {
        creation.tutorMode = response.mode;
        if (Array.isArray(response.missing) && response.missing.length > 0) {
            creation.tutorModeMissing = response.missing.filter(part => typeof part === "string");
        }
        if (TUTOR_SESSION_MODES.has(response.requestedMode)) {
            creation.tutorRequestedMode = response.requestedMode;
        }
    }

    if (caseContext) {
        creation.caseContext = caseContextOutcome(response, caseContextRejection);
        if (caseContextRejection !== undefined) {
            creation.caseContextRejection = caseContextRejection;
        }
    }

    return { sessionId, creation };
}

const CLAIM_TYPE_ID_PATTERN = /^AF[1-9][0-9]*$/u;
// The tutor writes at most 600 characters (ethicapp-ai-additions#204).
const MAX_CLAIM_TYPE_RATIONALE_LENGTH = 600;

// The object of a callback payload that carries one of `keys`: its top
// level, as the tutor sends analyses, or a nested feedback object.
function evaluationSource(requestPayload, keys) {
    const root = requestPayload && typeof requestPayload === "object" ? requestPayload : {};
    const reports = candidate => candidate && typeof candidate === "object"
        && keys.some(key => Object.hasOwn(candidate, key));
    return [root, root.payload?.feedback, root.payload].find(reports) ?? null;
}

/**
 * The claim type the tutor matched in an evaluation (#850,
 * ethicapp-ai-additions#204): `claimTypeId` (`AF#` or null) and the short
 * `claimTypeRationale` meant for teachers. The tutor sends them as top-level
 * keys of the callback payload of an analysis; a nested feedback object is
 * also read. null when the evaluation reports neither, as evaluations of
 * sessions without a typology do.
 *
 * @returns {{claimTypeId: string|null, claimTypeRationale: string|null}|null}
 */
export function claimTypeFromExternalResult(requestPayload) {
    const source = evaluationSource(requestPayload, ["claimTypeId", "claimTypeRationale"]);
    if (!source) {
        return null;
    }

    const id = normalizeText(source.claimTypeId);
    const rationale = normalizeText(source.claimTypeRationale);
    return {
        claimTypeId:        CLAIM_TYPE_ID_PATTERN.test(id) ? id : null,
        claimTypeRationale: rationale ? rationale.slice(0, MAX_CLAIM_TYPE_RATIONALE_LENGTH) : null,
    };
}

const FACT_ID_PATTERN = /^EV[1-9][0-9]*$/u;
const EXCLUSION_ID_PATTERN = /^EX[1-9][0-9]*$/u;
// The tutor's own limits (ethicapp-ai-additions#209): at most 60 facts in an
// inventory, 10 unsupported claims of at most 400 characters each.
const MAX_EVIDENCE_FACT_IDS = 60;
const MAX_UNSUPPORTED_CLAIMS = 10;
const MAX_UNSUPPORTED_CLAIM_LENGTH = 400;

function unsupportedClaim(item) {
    const statement = normalizeText(item?.statement);
    if (!statement) {
        return null;
    }

    const exclusionId = normalizeText(item?.exclusionId);
    return {
        statement:   statement.slice(0, MAX_UNSUPPORTED_CLAIM_LENGTH),
        exclusionId: EXCLUSION_ID_PATTERN.test(exclusionId) ? exclusionId : null,
    };
}

/**
 * The mode of an evaluation and its teacher-facing evidence (#865,
 * ethicapp-ai-additions#209): `tutorMode` (`enhanced` or `basic`), which the
 * tutor reports in every analysis of a session opened with `case_context` or
 * `evaluation_mode`, `requestedMode`, the `evaluation_mode` the session was
 * opened with (#870, ethicapp-ai-additions#211), and, in the enhanced mode,
 * `evidenceFactIds` (the inventory facts the argument states) and
 * `unsupportedClaims` (`{ statement, exclusionId }`). null when the
 * evaluation reports no mode, as those of sessions opened with neither do.
 */
export function tutorEvaluationFromExternalResult(requestPayload) {
    const source = evaluationSource(requestPayload, ["tutorMode"]);
    const tutorMode = normalizeText(source?.tutorMode);
    if (!TUTOR_SESSION_MODES.has(tutorMode)) {
        return null;
    }

    const evaluation = { tutorMode };
    const requestedMode = normalizeText(source.requestedMode);
    if (TUTOR_SESSION_MODES.has(requestedMode)) {
        evaluation.requestedMode = requestedMode;
    }
    if (Array.isArray(source.evidenceFactIds)) {
        evaluation.evidenceFactIds = [...new Set(source.evidenceFactIds
            .map(normalizeText)
            .filter(id => FACT_ID_PATTERN.test(id)))]
            .slice(0, MAX_EVIDENCE_FACT_IDS);
    }
    if (Array.isArray(source.unsupportedClaims)) {
        evaluation.unsupportedClaims = source.unsupportedClaims
            .map(unsupportedClaim)
            .filter(Boolean)
            .slice(0, MAX_UNSUPPORTED_CLAIMS);
    }
    return evaluation;
}

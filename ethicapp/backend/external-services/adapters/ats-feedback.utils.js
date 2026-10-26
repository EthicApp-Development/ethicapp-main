import { plainTextOf } from "../../helpers/rich-text-helper.js";

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
        source:  "argumentation-tutor-system",
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
        source:   "argumentation-tutor-system",
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
 * not offered it (#733). An unset tier takes the tutor's default.
 */
export function buildAtsSessionPayload(metadata, serviceConfiguration = {}) {
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
    return body;
}

/**
 * Creates a tutor session and returns `{ sessionId, creation }`, where
 * `creation` is the tutor's lifecycle report for #737: `{ llmTier, model,
 * warnings, degraded, configurationRejected }`. The tutor answers 400 when a
 * configured value fails its format rules; the session is then created once
 * more with the tutor's defaults and `configurationRejected` says so.
 * @param {(body: object) => Promise<object>} request POST /sessions
 */
export async function createAtsSession({ metadata, serviceConfiguration = {}, request }) {
    const body = buildAtsSessionPayload(metadata, serviceConfiguration);
    let response;
    let configurationRejected = false;
    let rejection = null;

    try {
        response = await request(body);
    } catch (error) {
        if (Number(error?.statusCode) !== 400 || !body.llm_tier) {
            throw error;
        }
        console.warn("[ats-feedback] The tutor rejected the configured settings; "
            + "creating the session with its defaults.", error.responseBody ?? error);
        configurationRejected = true;
        rejection = error.responseBody ?? null;
        response = await request(buildAtsSessionPayload(metadata));
    }

    const sessionId = normalizeText(response?.session_id);
    if (!sessionId) {
        throw new Error("ATS did not return a session_id.");
    }

    return {
        sessionId,
        creation: {
            llmTier:  response?.llm_tier ?? null,
            model:    response?.model ?? null,
            warnings: Array.isArray(response?.warnings) ? response.warnings : [],
            degraded: response?.degraded === true,
            configurationRejected,
            ...(configurationRejected ? { rejection } : {}),
        },
    };
}

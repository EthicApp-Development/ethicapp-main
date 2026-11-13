import { activityLocale, DEFAULT_ACTIVITY_LOCALE } from "../../helpers/activity-locale.js";
import { plainTextOf } from "../../helpers/rich-text-helper.js";
import { describeError } from "../../helpers/log-safety.js";
import { ARGUMENTATION_TUTOR_SERVICE_ID } from "../../helpers/tutor-mode.js";
import {
    STUDENT_RESULT_DOCUMENT_SCHEMA,
    validateStudentResultDocument,
} from "../../services/student-result-documents.js";
import {
    argumentEvaluationOf,
    currentEvaluation,
    EVALUATION_CRITERION_KEYS,
    levelWithScaleText,
} from "./ats-feedback.evaluation.js";

// The tutor's catalog id, which design phases enable.
export { ARGUMENTATION_TUTOR_SERVICE_ID };

// The texts teachers read about this service (#723), available even when the
// tutor does not respond (#757).
const UI_TRANSLATIONS = {
    es_CL: {
        label:       "Tutor de argumentación",
        description: "Analiza los argumentos de cada participante y le entrega retroalimentación.",
    },
    en_US: {
        label:       "Argumentation tutor",
        description: "Analyzes each participant's arguments and gives them feedback.",
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

const EVALUATION_CRITERION_LABELS = Object.freeze({
    claim:     "Claim",
    evidence:  "Evidence",
    warrant:   "Warrant",
    qualifier: "Qualifier",
});

// The criteria of a v19 evaluation (#1214) in the shape of the legacy
// `criteria` list: the level as `score`, with the scale the evaluation gives
// it as `minScore` and `maxScore`, and `value` such as `2 (0-2)`. The claim's
// value adds the stance of its claim type. Unreadable criteria read
// `Not available`.
function evaluationCriteria(evaluation) {
    return EVALUATION_CRITERION_KEYS.map(key => {
        const criterion = evaluation?.criteria?.[key] ?? null;
        const item = { key, label: EVALUATION_CRITERION_LABELS[key] };
        if (!criterion) {
            return { ...item, score: null, value: "Not available" };
        }
        const stance = key === "claim" && criterion.stance ? `, ${criterion.stance}` : "";
        return {
            ...item,
            score:    criterion.level,
            minScore: criterion.min,
            maxScore: criterion.max,
            value:    `${levelWithScaleText(criterion)}${stance}`,
        };
    });
}

// A v19 comparison (#1214) in the shape of the legacy `comparison.scores`:
// per criterion the two levels, the change and the scale they share.
function evaluationComparisonScores(read) {
    return Object.fromEntries(EVALUATION_CRITERION_KEYS.map(key => {
        const initial = read.initial?.criteria[key] ?? null;
        const revised = read.revised?.criteria[key] ?? null;
        const scale = revised ?? initial;
        return [key, {
            initial: initial?.level ?? null,
            revised: revised?.level ?? null,
            delta:   read.differences?.[key]?.levelChange ?? null,
            min:     scale?.min ?? null,
            max:     scale?.max ?? null,
        }];
    }));
}

function normalizeCriteriaFromAts(parsedResult) {
    const evaluation = currentEvaluation(argumentEvaluationOf(parsedResult));
    if (evaluation) {
        return evaluationCriteria(evaluation);
    }

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

function argumentTexts(parsedResult, submissionMeta) {
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
    };
}

function extractComparisonData(parsedResult, submissionMeta = {}) {
    const read = argumentEvaluationOf(parsedResult);
    if (read?.kind === "comparison") {
        return {
            ...argumentTexts(parsedResult, submissionMeta),
            scores: evaluationComparisonScores(read),
        };
    }

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
        ...argumentTexts(parsedResult, submissionMeta),
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

// The scale bounds of a criteria item, when it carries them (v19, #1214).
function scaleBounds(item) {
    const bounds = {};
    for (const key of ["minScore", "maxScore"]) {
        if (Number.isFinite(item?.[key])) {
            bounds[key] = item[key];
        }
    }
    return bounds;
}

/**
 * The feedback object of a callback payload. A v19 payload (#1214) has no
 * `criteria` or `comparison`: they are read from its `argumentEvaluation`,
 * levels with their scales, and `rubric` says which rubric it follows.
 * Nothing of the evaluation's ids, fragments or reasons is copied.
 */
export function buildFeedbackPayloadFromExternalResult(requestPayload, fallbackContext) {
    const payloadRoot = requestPayload && typeof requestPayload === "object" ? requestPayload : {};
    const sourcePayload = payloadRoot?.payload?.feedback || payloadRoot?.payload || payloadRoot;
    const input = sourcePayload && typeof sourcePayload === "object" ? sourcePayload : {};

    const evaluation = argumentEvaluationOf(requestPayload);
    const legacyCriteria = Array.isArray(input.criteria) ? input.criteria : [];
    const criteria = evaluation && legacyCriteria.length === 0
        ? evaluationCriteria(currentEvaluation(evaluation))
        : legacyCriteria;
    const bullets = Array.isArray(input.bullets) ? input.bullets : [];
    const mode = normalizeText(input.mode) || evaluation?.kind || "analysis";
    const legacyComparison = input?.comparison && typeof input.comparison === "object"
        ? input.comparison
        : null;
    const comparison = evaluation?.kind === "comparison" && !legacyComparison
        ? {
            initialArgument: "",
            revisedArgument: "",
            scores:          evaluationComparisonScores(evaluation),
        }
        : legacyComparison;

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
                ...scaleBounds(item),
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
        ...(evaluation ? { rubric: evaluation.rubric } : {}),
        meta:            {
            sessionId:  Number(payloadRoot.sessionId) || fallbackContext?.sessionId || null,
            phaseId:    Number(payloadRoot.phaseId) || fallbackContext?.phaseId || null,
            questionId: Number(payloadRoot.questionId) || fallbackContext?.questionId || null,
            userId:     Number(payloadRoot.userId) || fallbackContext?.userId || null,
        },
    };
}

// ─── The activity's locale (#1133) ──────────────────────────────────────────

// The rule lives in helpers/activity-locale.js, which the registry also uses
// to pass the locale to handlers as `context.locale`.
export { activityLocale, DEFAULT_ACTIVITY_LOCALE };

// student-result/v1 names its locales as BCP 47 tags.
const DOCUMENT_LOCALES = Object.freeze({ es_CL: "es-CL", en_US: "en-US" });
const DEFAULT_DOCUMENT_LOCALE = DOCUMENT_LOCALES[DEFAULT_ACTIVITY_LOCALE];

/** The BCP 47 tag of an EthicApp or BCP 47 locale (`en_US`, `en-US`), or null. */
export function documentLocaleOf(locale) {
    const code = normalizeText(locale).replace("-", "_").toLowerCase();
    const match = Object.keys(DOCUMENT_LOCALES)
        .find(candidate => candidate.toLowerCase() === code);
    return match ? DOCUMENT_LOCALES[match] : null;
}

// ─── The student's document (epic #1124, #1133) ─────────────────────────────

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The fixed texts the adapter writes into a document, per locale. Titles,
// section titles, labels and values are the tutor's own
// (ethicapp-ai-additions `argumentation-tutor/backend/modules/student_result/messages.py`),
// so a mapped document reads like the tutor's, without its descriptions and
// overview. `message` goes with the document in the student's event.
const DOCUMENT_TEXTS = Object.freeze({
    "es-CL": {
        title: {
            analysis:   "Retroalimentación sobre tu argumento",
            comparison: "Retroalimentación sobre tu argumento revisado",
        },
        unavailableSummary: "No pudimos preparar la retroalimentación de tu argumento.",
        sections:           {
            criteria:         "Criterios",
            revisedCriteria:  "Criterios de tu argumento revisado",
            comparison:       "Cambios respecto de tu argumento anterior",
            bullets:          "Comentarios",
            argument:         "Tu argumento",
            previousArgument: "Tu argumento anterior",
            revisedArgument:  "Tu argumento revisado",
        },
        labels: {
            claim:     "Afirmación",
            evidence:  "Evidencia",
            warrant:   "Garantía",
            qualifier: "Calificador",
        },
        values: {
            inFavor:      "A favor",
            against:      "En contra",
            noPosition:   "Sin postura clara",
            score:        (score, maxScore) => `${score} de ${maxScore}`,
            notAvailable: "No disponible",
            present:      "Presente",
            absent:       "Ausente",
            withStance:   (score, stance) => `${score} · ${stance}`,
        },
        // The stance of the claim type the claim matches, relative to the
        // case's focal action (argument-evaluation/v1, #1214).
        stances: {
            in_favor:    "A favor",
            against:     "En contra",
            alternative: "Alternativa",
            conditional: "Condicional",
        },
        message: "Ya está disponible la retroalimentación sobre tu argumento.",
    },
    "en-US": {
        title: {
            analysis:   "Feedback on your argument",
            comparison: "Feedback on your revised argument",
        },
        unavailableSummary: "We could not prepare feedback on your argument.",
        sections:           {
            criteria:         "Criteria",
            revisedCriteria:  "Criteria of your revised argument",
            comparison:       "Changes from your previous argument",
            bullets:          "Comments",
            argument:         "Your argument",
            previousArgument: "Your previous argument",
            revisedArgument:  "Your revised argument",
        },
        labels: {
            claim:     "Claim",
            evidence:  "Evidence",
            warrant:   "Warrant",
            qualifier: "Qualifier",
        },
        values: {
            inFavor:      "In favor",
            against:      "Against",
            noPosition:   "No clear position",
            score:        (score, maxScore) => `${score} of ${maxScore}`,
            notAvailable: "Not available",
            present:      "Present",
            absent:       "Absent",
            withStance:   (score, stance) => `${score} · ${stance}`,
        },
        stances: {
            in_favor:    "In favor",
            against:     "Against",
            alternative: "Alternative",
            conditional: "Conditional",
        },
        message: "Feedback on your argument is now available.",
    },
});

// The tutor's scale and limits (`document.py` in the tutor), which the
// mapping follows so that its documents validate as the tutor's do.
const CRITERION_KEYS = Object.freeze(["claim", "evidence", "warrant", "qualifier"]);
const MIN_SCORE = 1;
const MAX_SCORE = 3;
const CLAIM_POSITIONS = new Map([[1, "inFavor"], [-1, "against"], [0, "noPosition"]]);
const MAX_BULLETS = 5;
const SUMMARY_MAX = 2000;
const BULLET_MAX = 1000;
const TEXT_MAX = 10000;
const ELLIPSIS = "…";

// The summary a tutor without `studentResult` sends when the model wrote no
// analysis, which is the usual case for an analysis; it is English whatever
// the activity's language, and says nothing the document does not.
const LEGACY_PLACEHOLDER_SUMMARY = "Argument feedback is now available.";

// A plain-text field: trimmed, cut to `limit` characters with an ellipsis,
// or null when blank.
function clippedText(value, limit) {
    if (typeof value !== "string") {
        return null;
    }
    const text = value.trim();
    if (!text) {
        return null;
    }
    return text.length <= limit
        ? text
        : `${text.slice(0, limit - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

function scaleScore(value) {
    return Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE ? value : null;
}

// `{ value, score, available }` of one criterion, as the tutor writes it: the
// claim is a position without a score; the others read `2 of 3` with their
// score, or `Not available` outside the scale.
function criterionResult(key, raw, texts) {
    const { values } = texts;
    if (key === "claim") {
        const position = Number.isInteger(raw) ? CLAIM_POSITIONS.get(raw) : undefined;
        return position
            ? { value: values[position], score: null, available: true }
            : { value: values.notAvailable, score: null, available: false };
    }
    const score = scaleScore(raw);
    return score === null
        ? { value: values.notAvailable, score: null, available: false }
        : { value: values.score(score, MAX_SCORE), score, available: true };
}

function criteriaItems(scores, texts) {
    let complete = true;
    const items = CRITERION_KEYS.map(key => {
        const { value, score, available } = criterionResult(key, scores.get(key), texts);
        complete = complete && available;
        const item = { key, label: texts.labels[key], value };
        if (score !== null) {
            Object.assign(item, { score, minScore: MIN_SCORE, maxScore: MAX_SCORE });
        }
        return item;
    });
    return { items, complete };
}

function trendOf(key, before, after) {
    const initial = scaleScore(before);
    const revised = scaleScore(after);
    if (key === "claim" || initial === null || revised === null) {
        return null;
    }
    if (revised > initial) {
        return "improved";
    }
    return revised < initial ? "declined" : "unchanged";
}

function comparisonItems(pairs, texts) {
    return CRITERION_KEYS.map(key => {
        const pair = isPlainObject(pairs[key]) ? pairs[key] : {};
        const item = {
            key,
            label:  texts.labels[key],
            before: criterionResult(key, pair.initial, texts).value,
            after:  criterionResult(key, pair.revised, texts).value,
        };
        const trend = trendOf(key, pair.initial, pair.revised);
        if (trend) {
            item.trend = trend;
        }
        return item;
    });
}

// The scores of the legacy `criteria` list, by criterion key.
function legacyCriterionScores(criteria) {
    const scores = new Map();
    for (const item of Array.isArray(criteria) ? criteria : []) {
        const key = normalizeText(item?.key || item?.label).toLowerCase();
        if (CRITERION_KEYS.includes(key) && !scores.has(key)) {
            scores.set(key, item?.score);
        }
    }
    return scores;
}

function textSection(title, value) {
    const text = clippedText(value, TEXT_MAX);
    return text ? [{ kind: "text", title, text }] : [];
}

// The feedback object of a callback payload, where the legacy reader looks
// for it (buildFeedbackPayloadFromExternalResult()).
function legacyFeedbackSource(requestPayload) {
    const root = isPlainObject(requestPayload) ? requestPayload : {};
    const source = root.payload?.feedback || root.payload || root;
    return isPlainObject(source) ? source : {};
}

/**
 * The `student-result/v1` document of a callback payload that carries no
 * `studentResult`: from a tutor that predates ethicapp-ai-additions#233, or
 * whose document failed the tutor's own validation. It is built from the
 * legacy keys (`summary`, `criteria`, `bullets`, `argumentPreview`,
 * `comparison`) as the tutor builds its own document, in `locale` (EthicApp
 * or BCP 47 spelling; `es-CL` when unknown), with the tutor's titles, labels
 * and values and without criterion descriptions or overview. No
 * teacher-only key is read.
 *
 * - The placeholder summary of an analysis without model text is left out,
 *   and so are bullets that repeat the summary.
 * - A score outside 1..3 reads `Not available`, carries no score and makes
 *   the document `partial`.
 * - A payload with neither criteria nor a comparison is `unavailable`.
 *
 * @returns {Object} A document that validateStudentResultDocument() accepts.
 */
export function legacyStudentDocument(requestPayload, locale) {
    const documentLocale = documentLocaleOf(locale) ?? DEFAULT_DOCUMENT_LOCALE;
    const texts = DOCUMENT_TEXTS[documentLocale];
    const input = legacyFeedbackSource(requestPayload);
    const document = { schemaVersion: STUDENT_RESULT_DOCUMENT_SCHEMA, locale: documentLocale };

    const scores = legacyCriterionScores(input.criteria);
    const comparison = isPlainObject(input.comparison) && isPlainObject(input.comparison.scores)
        ? input.comparison
        : null;
    const argument = input.argumentPreview || input.submitted_argument;

    if (!comparison && scores.size === 0) {
        return {
            ...document,
            title:    texts.title.analysis,
            summary:  texts.unavailableSummary,
            status:   "unavailable",
            sections: textSection(texts.sections.argument, argument),
        };
    }

    document.title = texts.title[comparison ? "comparison" : "analysis"];
    const summary = clippedText(input.summary, SUMMARY_MAX);
    if (summary && summary !== LEGACY_PLACEHOLDER_SUMMARY) {
        document.summary = summary;
    }

    const sections = [];
    if (comparison) {
        sections.push({
            kind:  "comparison",
            title: texts.sections.comparison,
            items: comparisonItems(comparison.scores, texts),
        });
    }
    const criteria = criteriaItems(scores, texts);
    sections.push({
        kind:  "criteria",
        title: texts.sections[comparison ? "revisedCriteria" : "criteria"],
        items: criteria.items,
    });

    const bullets = (Array.isArray(input.bullets) ? input.bullets : [])
        .map(bullet => clippedText(bullet, BULLET_MAX))
        .filter(bullet => bullet && bullet !== LEGACY_PLACEHOLDER_SUMMARY
            && bullet !== document.summary)
        .slice(0, MAX_BULLETS);
    if (bullets.length > 0) {
        sections.push({ kind: "bullets", title: texts.sections.bullets, items: bullets });
    }

    if (comparison) {
        sections.push(
            ...textSection(texts.sections.previousArgument, comparison.initialArgument),
            ...textSection(texts.sections.revisedArgument, argument || comparison.revisedArgument)
        );
    } else {
        sections.push(...textSection(texts.sections.argument, argument));
    }

    if (!criteria.complete) {
        document.status = "partial";
    }
    document.sections = sections;
    return document;
}

// `{ value, score, available }` of one v19 criterion (#1214): its level out
// of the scale the evaluation gives it, never a scale known here. A two-level
// scale (the qualifier's 0-1) reads as present or absent, and the claim adds
// the stance of its claim type; the claim type's id is never shown.
function evaluationCriterionResult(key, criterion, texts) {
    const { values } = texts;
    if (!criterion) {
        return { value: values.notAvailable, score: null, available: false };
    }
    const { level, min, max } = criterion;
    let value = max - min === 1
        ? (level === max ? values.present : values.absent)
        : values.score(level, max);
    const stance = key === "claim" ? texts.stances[criterion.stance] : undefined;
    if (stance) {
        value = values.withStance(value, stance);
    }
    return { value, score: level, available: true, min, max };
}

function evaluationCriteriaItems(evaluation, texts) {
    let complete = true;
    const items = EVALUATION_CRITERION_KEYS.map(key => {
        const result = evaluationCriterionResult(key, evaluation?.criteria[key] ?? null, texts);
        complete = complete && result.available;
        const item = { key, label: texts.labels[key], value: result.value };
        if (result.available) {
            Object.assign(item, { score: result.score, minScore: result.min, maxScore: result.max });
        }
        return item;
    });
    return { items, complete };
}

function evaluationTrend(change) {
    if (!Number.isInteger(change)) {
        return null;
    }
    if (change > 0) {
        return "improved";
    }
    return change < 0 ? "declined" : "unchanged";
}

function evaluationComparisonItems(read, texts) {
    return EVALUATION_CRITERION_KEYS.map(key => {
        const initial = read.initial?.criteria[key] ?? null;
        const revised = read.revised?.criteria[key] ?? null;
        const item = {
            key,
            label:  texts.labels[key],
            before: evaluationCriterionResult(key, initial, texts).value,
            after:  evaluationCriterionResult(key, revised, texts).value,
        };
        const trend = initial && revised
            ? evaluationTrend(read.differences?.[key]?.levelChange)
            : null;
        if (trend) {
            item.trend = trend;
        }
        return item;
    });
}

/**
 * The `student-result/v1` document of a v19 callback payload (#1214) that
 * carries no valid `studentResult`: built from its `argumentEvaluation`
 * (`read`, from argumentEvaluationOf()), in `locale` as
 * legacyStudentDocument() builds it, with the same titles, sections and
 * texts. Each level reads out of the scale the evaluation gives it, and the
 * claim with the stance of its claim type. The evaluation's ids (`AF#`,
 * `EV#`, `EX#`), fragments and reasons are never read into it. A criterion
 * that cannot be read makes the document `partial`.
 *
 * @returns {Object} A document that validateStudentResultDocument() accepts.
 */
export function evaluationStudentDocument(requestPayload, read, locale) {
    const documentLocale = documentLocaleOf(locale) ?? DEFAULT_DOCUMENT_LOCALE;
    const texts = DOCUMENT_TEXTS[documentLocale];
    const input = legacyFeedbackSource(requestPayload);
    const isComparison = read.kind === "comparison";
    const document = {
        schemaVersion: STUDENT_RESULT_DOCUMENT_SCHEMA,
        locale:        documentLocale,
        title:         texts.title[isComparison ? "comparison" : "analysis"],
    };
    const summary = clippedText(input.summary, SUMMARY_MAX);
    if (summary && summary !== LEGACY_PLACEHOLDER_SUMMARY) {
        document.summary = summary;
    }

    const sections = [];
    if (isComparison) {
        sections.push({
            kind:  "comparison",
            title: texts.sections.comparison,
            items: evaluationComparisonItems(read, texts),
        });
    }
    const criteria = evaluationCriteriaItems(currentEvaluation(read), texts);
    sections.push({
        kind:  "criteria",
        title: texts.sections[isComparison ? "revisedCriteria" : "criteria"],
        items: criteria.items,
    });

    const bullets = (Array.isArray(input.bullets) ? input.bullets : [])
        .map(bullet => clippedText(bullet, BULLET_MAX))
        .filter(bullet => bullet && bullet !== LEGACY_PLACEHOLDER_SUMMARY
            && bullet !== document.summary)
        .slice(0, MAX_BULLETS);
    if (bullets.length > 0) {
        sections.push({ kind: "bullets", title: texts.sections.bullets, items: bullets });
    }

    const argument = input.argumentPreview || input.submitted_argument;
    const comparison = isPlainObject(input.comparison) ? input.comparison : {};
    if (isComparison) {
        sections.push(
            ...textSection(texts.sections.previousArgument, comparison.initialArgument),
            ...textSection(texts.sections.revisedArgument, argument || comparison.revisedArgument)
        );
    } else {
        sections.push(...textSection(texts.sections.argument, argument));
    }

    const complete = criteria.complete && (!isComparison || Boolean(read.initial));
    if (!complete) {
        document.status = "partial";
    }
    document.sections = sections;
    return document;
}

/**
 * The document of a callback payload without a valid `studentResult`: from
 * its `argumentEvaluation` when it carries one (v19, #1214), from its legacy
 * keys otherwise (v12). `source` is `evaluation` or `legacy`.
 *
 * @returns {{document: Object, source: "evaluation"|"legacy"}}
 */
export function mappedStudentDocument(requestPayload, locale) {
    const read = argumentEvaluationOf(requestPayload);
    if (read) {
        const document = evaluationStudentDocument(requestPayload, read, locale);
        return { document, source: "evaluation" };
    }
    return { document: legacyStudentDocument(requestPayload, locale), source: "legacy" };
}

/**
 * The tutor's own document (ethicapp-ai-additions#233): the callback
 * payload's `studentResult`, read at its top level as the tutor sends it, or
 * in a nested feedback object as the legacy keys are read.
 *
 * `document` is that object, unchanged, when it passes EthicApp's checks of
 * the schema (validateStudentResultDocument()), and null otherwise.
 * `problems` are the checks' problems (codes and paths, which may be logged)
 * when the payload carries a `studentResult` that fails them, and null when
 * it carries none or a valid one.
 *
 * @returns {{document: Object|null, problems: Object[]|null}}
 */
export function tutorStudentDocument(requestPayload) {
    const root = isPlainObject(requestPayload) ? requestPayload : {};
    const carrier = [root, root.payload?.feedback, root.payload]
        .find(candidate => isPlainObject(candidate) && Object.hasOwn(candidate, "studentResult"));
    if (!carrier) {
        return { document: null, problems: null };
    }

    const candidate = carrier.studentResult;
    const { valid, problems } = validateStudentResultDocument(
        STUDENT_RESULT_DOCUMENT_SCHEMA, candidate
    );
    return valid ? { document: candidate, problems: null } : { document: null, problems };
}

/**
 * What the adapter publishes to the student for one tutor callback: built
 * live when the callback arrives, and rebuilt from the stored callback when
 * the student loads the activity (`student-results-reading`, #1126). Both
 * paths call it, so the rebuilt result is the one published live.
 *
 * The result is a `student-result/v1` document (epic #1124): the tutor's
 * `studentResult`, unchanged, when it carries a valid one
 * (tutorStudentDocument()), and otherwise the payload mapped by
 * mappedStudentDocument() in the locale `resolveLocale()` gives, which is
 * called only then: its v19 `argumentEvaluation` (#1214) when it has one,
 * its legacy keys otherwise. The teacher-only keys of the payload (the claim
 * type of #850, the mode and evidence of #865, the evaluation's ids,
 * fragments and reasons) are never read into it; they are only recorded with
 * the result.
 *
 * `destination` is the callback's trusted destination (`sessionId`,
 * `phaseId`, `questionId`, `userId`): the job's when the callback arrives,
 * the stored result's ids, which the result took from the same job, when it
 * is rebuilt. The ids the callback payload names come first; the registry
 * refuses a callback whose ids differ from its job's (#815).
 *
 * @param {Object} requestPayload - The callback payload, as stored in
 *     `external_service_results.raw_payload`.
 * @param {{sessionId, phaseId, questionId, userId}} destination
 * @param {Object} [options]
 * @param {() => Promise<string|null>} [options.resolveLocale] - The
 *     activity's locale for a mapped document; null gives `es-CL`.
 * @returns {Promise<{fallbackContext: Object, source: "tutor"|"evaluation"|"legacy",
 *     tutorDocumentProblems: Object[]|null, studentResult: {phaseId:
 *     number|null, questionId: number|null, documentSchema: string,
 *     document: Object, message: string, status: string}}>}
 *     `studentResult` is the publishStudentResult() payload without
 *     `userId`, `sessionId` and `resultId`.
 */
export async function buildStudentFeedback(requestPayload, destination, {
    resolveLocale = async () => null,
} = {}) {
    const payloadRoot = isPlainObject(requestPayload) ? requestPayload : {};
    const fallbackContext = {
        sessionId:  Number(payloadRoot.sessionId) || destination?.sessionId,
        phaseId:    Number(payloadRoot.phaseId) || destination?.phaseId,
        questionId: Number(payloadRoot.questionId) || destination?.questionId,
        userId:     Number(payloadRoot.userId) || destination?.userId,
    };

    const tutor = tutorStudentDocument(requestPayload);
    const mapped = tutor.document
        ? { document: tutor.document, source: "tutor" }
        : mappedStudentDocument(requestPayload, await resolveLocale());
    const { document } = mapped;
    return {
        fallbackContext,
        source:                mapped.source,
        tutorDocumentProblems: tutor.problems,
        studentResult:         {
            phaseId:        Number(fallbackContext.phaseId) || null,
            questionId:     Number(fallbackContext.questionId) || null,
            documentSchema: STUDENT_RESULT_DOCUMENT_SCHEMA,
            document,
            message:        DOCUMENT_TEXTS[document.locale]?.message
                ?? DOCUMENT_TEXTS[DEFAULT_DOCUMENT_LOCALE].message,
            status: normalizeText(payloadRoot.status) || "completed",
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
 * The body of POST /sessions (#736). The settings sent are the configured
 * `llm_tier` (#734) and `evaluation_rubric` (#1214,
 * ethicapp-ai-additions#275: `v19`, the tutor's default, or the deprecated
 * `v12`), each only when the phase stores one; the deprecated `model` is not
 * sent, and new designs are not offered it (#733). An unset tier or rubric
 * takes the tutor's default. In the
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
 *
 * `locale` (#1133, ethicapp-ai-additions#233) is the activity's locale
 * (activityLocale()), the language the tutor writes the student's feedback
 * in. It is a session input, like `case_context`, never a teacher setting;
 * null leaves it out.
 */
export function buildAtsSessionPayload(
    metadata,
    serviceConfiguration = {},
    caseContext = null,
    evaluationMode = null,
    locale = null
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
    const rubric = normalizeText(serviceConfiguration?.evaluation_rubric);
    if (rubric) {
        body.evaluation_rubric = rubric;
    }
    if (evaluationMode) {
        body.evaluation_mode = evaluationMode;
    }
    if (caseContext) {
        body.case_context = caseContext;
    }
    if (locale) {
        body.locale = locale;
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
// And the locale: `400 {"error": "Invalid locale", "errors": {"locale":
// "..."}}` (ethicapp-ai-additions#233).
const LOCALE_NAME = /\blocale\b/iu;

/**
 * Which optional part of a session body the tutor refused with a 400, so it
 * can be left out: `case_context` when the error names it, `locale` when the
 * error names it, `case_context` when it is the only other optional part
 * sent, otherwise the configured settings (`llm_tier`, `evaluation_rubric`),
 * which are dropped together. null when the body has no optional part left.
 */
function rejectedOptionalField(error, body) {
    const answer = JSON.stringify(error?.responseBody ?? null);
    const configured = Boolean(body.llm_tier || body.evaluation_rubric);
    if (body.case_context && CASE_CONTEXT_NAME.test(answer)) {
        return "case_context";
    }
    if (body.locale && LOCALE_NAME.test(answer)) {
        return "locale";
    }
    if (body.case_context && !configured) {
        return "case_context";
    }
    return configured ? "configuration" : null;
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
 * `locale` is sent as `locale` (#1133) and kept when the configured
 * settings are rejected. `creation.locale` is the locale the tutor reports
 * back, which a tutor that predates ethicapp-ai-additions#233 does not (it
 * reports the key as unsupported, `degraded: true`). A locale the tutor
 * refuses with a 400 is dropped and the session created again without it,
 * in the tutor's default language; `creation.localeRejection` holds the
 * tutor's answer.
 *
 * @param {(body: object) => Promise<object>} request POST /sessions
 */
export async function createAtsSession({
    metadata,
    serviceConfiguration = {},
    caseContext = null,
    evaluationMode = null,
    locale = null,
    request,
}) {
    let configuration = serviceConfiguration;
    let context = caseContext;
    let sessionLocale = locale;
    let configurationRejected = false;
    let rejection = null;
    let caseContextRejection;
    let localeRejection;
    let response;

    for (;;) {
        const body = buildAtsSessionPayload(
            metadata, configuration, context, evaluationMode, sessionLocale
        );
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

            if (field === "locale") {
                console.warn("[ats-feedback] The tutor rejected the activity's locale; "
                    + "creating the session without it.", describeError(error));
                sessionLocale = null;
                localeRejection = error.responseBody ?? null;
                continue;
            }

            // The rejection itself is kept in the instantiation report.
            console.warn("[ats-feedback] The tutor rejected the configured settings; "
                + "creating the session with its defaults.", describeError(error));
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

    const reportedLocale = documentLocaleOf(response?.locale);
    if (reportedLocale) {
        creation.locale = reportedLocale;
    }
    if (localeRejection !== undefined) {
        creation.localeRejection = localeRejection;
    }

    // The rubric the tutor reports for the session (#1214), when it does.
    const reportedRubric = normalizeText(response?.rubric);
    if (/^v[1-9][0-9]*$/u.test(reportedRubric)) {
        creation.rubric = reportedRubric;
    }

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
 * A v19 payload (#1214) reports the claim type inside its
 * `argumentEvaluation`, for an analysis and for the revised argument of a
 * comparison; it is read from there, without a rationale (the evaluation's
 * `reason` is not copied).
 *
 * @returns {{claimTypeId: string|null, claimTypeRationale: string|null}|null}
 */
export function claimTypeFromExternalResult(requestPayload) {
    const source = evaluationSource(requestPayload, ["claimTypeId", "claimTypeRationale"]);
    if (!source) {
        const claim = currentEvaluation(argumentEvaluationOf(requestPayload))?.criteria.claim;
        return claim ? { claimTypeId: claim.claimTypeId, claimTypeRationale: null } : null;
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
 *
 * A v19 payload (#1214) reports them inside its `argumentEvaluation`, for
 * analyses and comparisons alike: `tutorMode`, `requestedMode`, and the
 * facts of the evaluation (the revised one of a comparison) as
 * `evidenceFactIds`. It reports no unsupported claims.
 */
export function tutorEvaluationFromExternalResult(requestPayload) {
    const source = evaluationSource(requestPayload, ["tutorMode"]);
    if (!source) {
        return evaluationModeOf(argumentEvaluationOf(requestPayload));
    }
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

// tutorEvaluationFromExternalResult() of a v19 evaluation (#1214).
function evaluationModeOf(read) {
    if (!read?.tutorMode) {
        return null;
    }
    const evaluation = { tutorMode: read.tutorMode };
    if (read.requestedMode) {
        evaluation.requestedMode = read.requestedMode;
    }
    const evidence = currentEvaluation(read)?.criteria.evidence;
    if (evidence) {
        evaluation.evidenceFactIds = evidence.factIds;
    }
    return evaluation;
}

// Pure helpers for the case evaluation tab (#844, epic #647): turn a
// `case-evaluation/v1` document from Case Analyst into what the read-only view
// shows. The document is validated by the service and checked by the adapter;
// these helpers still tolerate missing parts, so a partial document renders.

// Evaluators and criteria with a translated label. The document accepts any
// snake_case criterion, so unknown ones fall back to a label built from the
// name (see criterionLabel).
export const CASE_EVALUATION_EVALUATORS = Object.freeze([
    "prompt001",
    "prompt002",
    "prompt003",
    "prompt004",
    "prompt005",
    "prompt006",
    "prompt007",
]);

export const CASE_EVALUATION_CRITERIA = Object.freeze([
    "writing_clarity",
    "narrative_structure",
    "case_realism",
    "ethical_conflict",
    "decision_complexity",
    "viewpoint_divergence",
    "position_defensibility",
    "character_depth",
    "perspective_complexity",
    "reader_identification",
    "personal_engagement",
    "audience_relevance",
    "pedagogical_alignment",
]);

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function list(value) {
    return Array.isArray(value) ? value : [];
}

function text(value) {
    return typeof value === "string" ? value.trim() : "";
}

function quotes(value) {
    return list(value).map(text).filter(Boolean);
}

function byPriority(left, right) {
    return left.priority - right.priority;
}

function priority(value) {
    return Number.isInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

/**
 * `{ key, fallback }` for a criterion: the translation key of a known one,
 * or null and a label built from its name ("new_criterion" → "New criterion").
 */
export function criterionLabel(criterion) {
    const name = text(criterion);
    if (CASE_EVALUATION_CRITERIA.includes(name)) {
        return { key: `case_evaluation_criterion_${name}`, fallback: name };
    }

    const words = name.replace(/_+/gu, " ").trim();
    return { key: null, fallback: words ? words[0].toUpperCase() + words.slice(1) : "" };
}

// `{ key, fallback }` for an evaluator id, as for criteria.
export function evaluatorLabel(evaluator) {
    const id = text(evaluator);
    return CASE_EVALUATION_EVALUATORS.includes(id)
        ? { key: `case_evaluation_evaluator_${id}`, fallback: id }
        : { key: null, fallback: id };
}

function selectedIssue(issue) {
    return {
        priority:        priority(issue.priority),
        issue:           text(issue.issue),
        selectionReason: text(issue.selectionReason),
        caseEvidence:    quotes(issue.caseEvidence),
        recommendation:  text(issue.recommendation),
        supportedBy:     list(issue.supportedBy)
            .filter(isPlainObject)
            .map(source => ({
                evaluator: text(source.evaluator),
                criterion: criterionLabel(source.criterion),
            })),
    };
}

function recommendation(item) {
    return {
        priority:       priority(item.priority),
        recommendation: text(item.recommendation),
        caseEvidence:   quotes(item.caseEvidence),
    };
}

function criterionResult(result) {
    return {
        criterion:  text(result.criterion),
        label:      criterionLabel(result.criterion),
        feedback:   text(result.feedback),
        evidence:   quotes(result.evidence),
        suggestion: text(result.suggestion),
    };
}

/**
 * What the case evaluation tab shows:
 *
 * - `summary` and `recommendations` (by priority): the final feedback;
 * - `issues` (by priority): the selected issues that explain it;
 * - `evaluators`: per-criterion feedback, grouped by evaluator in the order
 *   of the document. Entries of the same evaluator are merged.
 */
export function buildCaseEvaluationView(document) {
    const synthesis = isPlainObject(document?.synthesis) ? document.synthesis : {};
    const finalFeedback = isPlainObject(synthesis.finalFeedback) ? synthesis.finalFeedback : {};

    const evaluators = [];
    const byEvaluator = new Map();
    for (const evaluation of list(document?.evaluations).filter(isPlainObject)) {
        const id = text(evaluation.evaluator);
        let group = byEvaluator.get(id);
        if (!group) {
            group = { evaluator: id, label: evaluatorLabel(id), results: [] };
            byEvaluator.set(id, group);
            evaluators.push(group);
        }
        group.results.push(...list(evaluation.results).filter(isPlainObject).map(criterionResult));
    }

    return {
        summary:         text(finalFeedback.summary),
        recommendations: list(finalFeedback.recommendations)
            .filter(isPlainObject)
            .map(recommendation)
            .sort(byPriority),
        issues: list(synthesis.selectedIssues)
            .filter(isPlainObject)
            .map(selectedIssue)
            .sort(byPriority),
        evaluators: evaluators.filter(group => group.results.length > 0),
    };
}

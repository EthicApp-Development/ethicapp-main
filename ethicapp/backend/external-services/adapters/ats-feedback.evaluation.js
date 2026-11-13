/**
 * The tutor's evaluation with the coders' Toulmin rubric (prompt v19, epic
 * ethicapp-ai-additions#267, #1214): the `argumentEvaluation` key of a
 * callback payload, an `argument-evaluation/v1` document
 * (canonical-schemas/ai-additions/argument-evaluation.v1.schema.json).
 *
 * A v19 payload carries `argumentEvaluation` and `rubric: "v19"`, and none
 * of the v12 score keys; a v12 payload carries the score keys (`criteria`,
 * `comparison`) and no `argumentEvaluation`. The adapter reads the document
 * when the payload has one and the legacy keys otherwise.
 *
 * The document is read criterion by criterion, never all or nothing, and
 * every level is read with the scale the document gives it, never with a
 * scale known here: a level is kept only when it is an integer within that
 * scale. The reading is lenient because stored payloads of a forgotten
 * student have every string replaced by a placeholder (V31), which keeps
 * the levels and scales (numbers) and loses the ids, kinds and stances.
 *
 * Nothing read here quotes the student: the criteria's `fragment` and
 * `reason` are never read. The `AF#`, `EV#` and `EX#` ids are for teachers
 * only and never reach a student document.
 */

export const ARGUMENT_EVALUATION_SCHEMA = "argument-evaluation/v1";

// The rubric's criteria, in the order the views show them.
export const EVALUATION_CRITERION_KEYS = Object.freeze([
    "claim", "evidence", "warrant", "qualifier",
]);

const EVALUATION_KINDS = new Set(["analysis", "comparison"]);
// v1 describes the enhanced mode only; the basic variant
// (ethicapp-ai-additions#277) is read as well when it comes.
const TUTOR_MODES = new Set(["enhanced", "basic"]);
const CLAIM_STANCES = new Set(["in_favor", "against", "alternative", "conditional"]);
const PROMPT_LOCALES = new Set(["es-CL", "en-US"]);

const SCHEMA_VERSION_PATTERN = /^argument-evaluation\/v[1-9][0-9]*$/u;
const RUBRIC_PATTERN = /^v[1-9][0-9]*$/u;
const RUBRIC_VERSION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/v[1-9][0-9]*$/u;
const CLAIM_TYPE_ID_PATTERN = /^AF[1-9][0-9]*$/u;
const FACT_ID_PATTERN = /^EV[1-9][0-9]*$/u;
const EXCLUSION_ID_PATTERN = /^EX[1-9][0-9]*$/u;

// The schema's limits.
const MAX_FACT_IDS = 60;
const MAX_EXCLUSION_IDS = 25;
const MAX_RUBRIC_VERSION_LENGTH = 64;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function oneOf(values, value) {
    return typeof value === "string" && values.has(value) ? value : null;
}

function matching(pattern, value) {
    return typeof value === "string" && pattern.test(value) ? value : null;
}

function idList(value, pattern, limit) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.filter(id => typeof id === "string" && pattern.test(id)))]
        .slice(0, limit);
}

function nonNegativeIntegerOrNull(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

// The object of a callback payload that carries `key`: its top level, as the
// tutor sends it, or a nested feedback object, as the legacy keys are read.
function carrierOf(requestPayload, key) {
    const root = isPlainObject(requestPayload) ? requestPayload : {};
    return [root, root.payload?.feedback, root.payload]
        .find(candidate => isPlainObject(candidate) && Object.hasOwn(candidate, key)) ?? null;
}

/**
 * The rubric the payload says its evaluation follows (`rubric`, for example
 * `v19` or `v12`, the value of the tutor's `evaluation_rubric` field,
 * ethicapp-ai-additions#275), or null when it says none, as payloads of
 * tutors that predate it do.
 */
export function tutorRubricOf(requestPayload) {
    return matching(RUBRIC_PATTERN, carrierOf(requestPayload, "rubric")?.rubric);
}

/** `{ min, max }` of a scale: integers with min < max, or null. */
function scaleOf(raw) {
    if (!isPlainObject(raw) || !Number.isInteger(raw.min) || !Number.isInteger(raw.max)
        || raw.min >= raw.max) {
        return null;
    }
    return { min: raw.min, max: raw.max };
}

function withinScale(value, scale) {
    return Number.isInteger(value) && value >= scale.min && value <= scale.max ? value : null;
}

// One criterion: `{ level, min, max }` and its criterion-specific keys, or
// null when its level is not an integer within its own scale.
function readCriterion(key, raw) {
    if (!isPlainObject(raw)) {
        return null;
    }
    const scale = scaleOf(raw.scale);
    const level = scale ? withinScale(raw.level, scale) : null;
    if (level === null) {
        return null;
    }

    const criterion = { level, min: scale.min, max: scale.max };
    switch (key) {
    case "claim":
        criterion.claimTypeId = matching(CLAIM_TYPE_ID_PATTERN, raw.claimTypeId);
        criterion.stance = oneOf(CLAIM_STANCES, raw.stance);
        break;
    case "evidence":
        criterion.factIds = idList(raw.factIds, FACT_ID_PATTERN, MAX_FACT_IDS);
        criterion.exclusionIds = idList(raw.exclusionIds, EXCLUSION_ID_PATTERN, MAX_EXCLUSION_IDS);
        criterion.notInCaseCount = nonNegativeIntegerOrNull(raw.notInCaseCount);
        break;
    case "warrant":
        criterion.rawLevel = withinScale(raw.rawLevel, scale);
        criterion.factId = matching(FACT_ID_PATTERN, raw.factId);
        break;
    case "qualifier":
        criterion.rawLevel = withinScale(raw.rawLevel, scale);
        break;
    default:
        break;
    }
    return criterion;
}

// One evaluation, or null when it has no readable criterion.
function readEvaluation(raw) {
    if (!isPlainObject(raw) || !isPlainObject(raw.criteria)) {
        return null;
    }
    const criteria = Object.fromEntries(EVALUATION_CRITERION_KEYS
        .map(key => [key, readCriterion(key, raw.criteria[key])]));
    if (Object.values(criteria).every(criterion => criterion === null)) {
        return null;
    }

    const rubricVersion = typeof raw.rubricVersion === "string"
        && raw.rubricVersion.length <= MAX_RUBRIC_VERSION_LENGTH
        ? matching(RUBRIC_VERSION_PATTERN, raw.rubricVersion)
        : null;
    return {
        rubricVersion,
        promptLocale:     oneOf(PROMPT_LOCALES, raw.promptLocale),
        criteria,
        entryRuleApplied: typeof raw.entryRuleApplied === "boolean" ? raw.entryRuleApplied : null,
    };
}

function levelChange(raw, initial, revised) {
    if (Number.isInteger(raw?.levelChange)) {
        return raw.levelChange;
    }
    return initial && revised ? revised.level - initial.level : null;
}

// A comparison's differences: as the document states them, or computed from
// the two evaluations where it states none it can be read with.
function readDifferences(raw, initial, revised) {
    const differences = isPlainObject(raw) ? raw : {};
    const result = Object.fromEntries(EVALUATION_CRITERION_KEYS.map(key => [key, {
        levelChange: levelChange(differences[key], initial?.criteria[key], revised?.criteria[key]),
    }]));

    const claim = isPlainObject(differences.claim) ? differences.claim : {};
    result.claim.claimTypeChanged = typeof claim.claimTypeChanged === "boolean"
        ? claim.claimTypeChanged
        : null;
    result.claim.stanceChanged = typeof claim.stanceChanged === "boolean"
        ? claim.stanceChanged
        : null;

    const evidence = isPlainObject(differences.evidence) ? differences.evidence : {};
    result.evidence.factIdsGained = idList(evidence.factIdsGained, FACT_ID_PATTERN, MAX_FACT_IDS);
    result.evidence.factIdsLost = idList(evidence.factIdsLost, FACT_ID_PATTERN, MAX_FACT_IDS);
    return result;
}

// The document's kind; a redacted one is told by its keys.
function kindOf(document) {
    const kind = oneOf(EVALUATION_KINDS, document.kind);
    if (kind) {
        return kind;
    }
    if (isPlainObject(document.evaluation)) {
        return "analysis";
    }
    return isPlainObject(document.initial) || isPlainObject(document.revised)
        ? "comparison"
        : null;
}

/**
 * The payload's `argumentEvaluation`, read leniently (see the module
 * comment), or null when the payload has none, or one of another major
 * version, or one without a readable level.
 *
 * @returns {null|{
 *     kind: "analysis"|"comparison",
 *     rubric: string|null,
 *     tutorMode: string|null,
 *     requestedMode: string|null,
 *     evaluation: Object|null,
 *     initial: Object|null,
 *     revised: Object|null,
 *     differences: Object|null,
 * }} `evaluation` for an analysis; `initial`, `revised` and `differences`
 *     for a comparison. An evaluation is `{ rubricVersion, promptLocale,
 *     criteria: { claim, evidence, warrant, qualifier }, entryRuleApplied }`,
 *     where each criterion is `{ level, min, max, ... }` or null.
 */
export function argumentEvaluationOf(requestPayload) {
    const document = carrierOf(requestPayload, "argumentEvaluation")?.argumentEvaluation;
    if (!isPlainObject(document)) {
        return null;
    }
    const schemaVersion = document.schemaVersion;
    if (typeof schemaVersion === "string" && SCHEMA_VERSION_PATTERN.test(schemaVersion)
        && schemaVersion !== ARGUMENT_EVALUATION_SCHEMA) {
        return null;
    }

    const kind = kindOf(document);
    const read = {
        kind,
        rubric:        tutorRubricOf(requestPayload),
        tutorMode:     oneOf(TUTOR_MODES, document.tutorMode),
        requestedMode: oneOf(TUTOR_MODES, document.requestedMode),
        evaluation:    null,
        initial:       null,
        revised:       null,
        differences:   null,
    };

    if (kind === "analysis") {
        read.evaluation = readEvaluation(document.evaluation);
        return read.evaluation ? read : null;
    }
    if (kind === "comparison") {
        read.initial = readEvaluation(document.initial);
        read.revised = readEvaluation(document.revised);
        if (!read.initial && !read.revised) {
            return null;
        }
        read.differences = readDifferences(document.differences, read.initial, read.revised);
        return read;
    }
    return null;
}

/**
 * The evaluation a result stands for: an analysis's evaluation, or the
 * revised one of a comparison, as the v12 payloads report the revised
 * scores. null when it could not be read.
 */
export function currentEvaluation(read) {
    if (!read) {
        return null;
    }
    return read.kind === "comparison" ? read.revised : read.evaluation;
}

/** `2 (0-2)`: a level with its scale, as teachers read it; null without one. */
export function levelWithScaleText(criterion) {
    return criterion ? `${criterion.level} (${criterion.min}-${criterion.max})` : null;
}

/** `0-2`: a criterion's scale; null without one. */
export function scaleText(criterion) {
    return criterion ? `${criterion.min}-${criterion.max}` : null;
}

function evaluationRecord(evaluation) {
    if (!evaluation) {
        return null;
    }
    const { claim, evidence, warrant } = evaluation.criteria;
    return {
        rubricVersion: evaluation.rubricVersion,
        levels:        Object.fromEntries(EVALUATION_CRITERION_KEYS.map(key => {
            const criterion = evaluation.criteria[key];
            return [key, criterion
                ? { level: criterion.level, min: criterion.min, max: criterion.max }
                : null];
        })),
        claimTypeId:      claim?.claimTypeId ?? null,
        stance:           claim?.stance ?? null,
        factIds:          evidence?.factIds ?? [],
        exclusionIds:     evidence?.exclusionIds ?? [],
        notInCaseCount:   evidence?.notInCaseCount ?? null,
        warrantFactId:    warrant?.factId ?? null,
        entryRuleApplied: evaluation.entryRuleApplied,
    };
}

/**
 * What the `callback-received` handler records about a v19 evaluation for
 * teachers, next to the stored payload: levels with their scales, the
 * claim type with its stance, and the facts and exclusions used; for a
 * comparison, both evaluations and the level changes. Ids and numbers only,
 * no text of the model or the student. null when `read` is null.
 */
export function evaluationRecordOf(read) {
    if (!read) {
        return null;
    }
    const base = { kind: read.kind, rubric: read.rubric };
    if (read.kind === "analysis") {
        return { ...base, ...evaluationRecord(read.evaluation) };
    }
    return {
        ...base,
        initial:     evaluationRecord(read.initial),
        revised:     evaluationRecord(read.revised),
        differences: read.differences,
    };
}

/**
 * The keys the `callback-received` handler adds to its recorded outcome for
 * the rubric (#1214): `rubric` when the payload states one, and
 * `rubricEvaluation` (evaluationRecordOf()) when it carries a readable
 * `argumentEvaluation`. Empty for a payload with neither, so the outcome of
 * a v12 callback keeps its shape.
 */
export function rubricOutcomeOf(requestPayload) {
    const outcome = {};
    const rubric = tutorRubricOf(requestPayload);
    if (rubric) {
        outcome.rubric = rubric;
    }
    const read = argumentEvaluationOf(requestPayload);
    if (read) {
        outcome.rubricEvaluation = evaluationRecordOf(read);
    }
    return outcome;
}

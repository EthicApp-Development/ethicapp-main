/**
 * Pure reading of the tutor's v19 rubric (#1214, epic
 * ethicapp-ai-additions#267) for the legacy chat feedback
 * (ArgumentTutorChatFeedback.jsx): an `argumentEvaluation`
 * (argument-evaluation/v1), or `comparison.scores` entries that carry their
 * scale (`min`, `max`). Every criterion is a level read with the scale the
 * payload gives it, and the claim carries the stance of its claim type. The
 * v12 payloads (the claim as a position, the other criteria as scores) are
 * read by the component as before.
 *
 * Only levels, scales and stances are read from an evaluation: its claim
 * type, fact and exclusion ids, fragments and reasons are for teachers and
 * never reach the student's screen.
 */

export const CRITERION_KEYS = Object.freeze(['claim', 'evidence', 'warrant', 'qualifier']);

const STANCE_KEYS = Object.freeze({
  in_favor: 'sessionDetail.atsClaimInFavor',
  against: 'sessionDetail.atsClaimAgainst',
  alternative: 'sessionDetail.atsClaimAlternative',
  conditional: 'sessionDetail.atsClaimConditional'
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function scaleOf(raw) {
  if (!isPlainObject(raw) || !Number.isInteger(raw.min) || !Number.isInteger(raw.max) || raw.min >= raw.max) {
    return null;
  }
  return { min: raw.min, max: raw.max };
}

// `{ level, min, max, stance }` of one evaluation criterion, or null when its
// level is not an integer within its own scale.
function criterionLevel(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const scale = scaleOf(raw.scale);
  if (!scale || !Number.isInteger(raw.level) || raw.level < scale.min || raw.level > scale.max) {
    return null;
  }
  const stance = typeof raw.stance === 'string' && STANCE_KEYS[raw.stance] ? raw.stance : null;
  return { level: raw.level, ...scale, stance };
}

function evaluationLevels(evaluation) {
  const criteria = isPlainObject(evaluation?.criteria) ? evaluation.criteria : {};
  return Object.fromEntries(CRITERION_KEYS.map((key) => [key, criterionLevel(criteria[key])]));
}

/**
 * The v19 evaluation of a feedback payload, reduced to what the student may
 * see, or null for a payload without one (v12).
 * @returns {null|{ kind: 'analysis'|'comparison', levels?: object,
 *   initial?: object, revised?: object, changes?: object }}
 */
export function readArgumentEvaluation(feedback) {
  const document = feedback?.argumentEvaluation;
  if (!isPlainObject(document)) {
    return null;
  }
  if (document.kind === 'analysis' && isPlainObject(document.evaluation)) {
    return { kind: 'analysis', levels: evaluationLevels(document.evaluation) };
  }
  if (document.kind === 'comparison' && (isPlainObject(document.initial) || isPlainObject(document.revised))) {
    const differences = isPlainObject(document.differences) ? document.differences : {};
    return {
      kind: 'comparison',
      initial: evaluationLevels(document.initial),
      revised: evaluationLevels(document.revised),
      changes: Object.fromEntries(CRITERION_KEYS.map((key) => {
        const change = differences[key]?.levelChange;
        return [key, Number.isInteger(change) ? change : null];
      }))
    };
  }
  return null;
}

/**
 * The text of one level: `2 of 2`, a two-level scale (the qualifier's 0-1) as
 * present or absent, and the claim with its stance (`2 of 2 · Against`).
 * null without a level.
 */
export function levelText(key, criterion, t) {
  if (!criterion) {
    return null;
  }
  let text = criterion.max - criterion.min === 1
    ? t(criterion.level === criterion.max ? 'sessionDetail.atsQualifierPresent' : 'sessionDetail.atsQualifierAbsent')
    : t('sessionDetail.atsLevelOfScale', { level: criterion.level, max: criterion.max });
  if (key === 'claim' && criterion.stance) {
    text = `${text} · ${t(STANCE_KEYS[criterion.stance])}`;
  }
  return text;
}

/**
 * The analysis pills of a v19 evaluation: `{ key, value }` per readable
 * criterion, in the rubric's order.
 */
export function evaluationCriteriaPills(evaluation, t) {
  if (evaluation?.kind !== 'analysis') {
    return [];
  }
  return CRITERION_KEYS
    .map((key) => ({ key, value: levelText(key, evaluation.levels[key], t) }))
    .filter((pill) => pill.value);
}

/**
 * The rows of a v19 comparison: `{ key, initial, revised, delta }`, the
 * levels as texts and `delta` the level change (a number) or null. They come
 * from the `argumentEvaluation` when the payload has one, and otherwise from
 * the `comparison.scores` entries that carry their scale (`min`, `max`), as
 * EthicApp's feedback payload gives a v19 comparison. null for a v12
 * comparison, whose entries have no scale: the component keeps showing it as
 * before.
 */
export function v19ComparisonRows(feedback, t) {
  const evaluation = readArgumentEvaluation(feedback);
  if (evaluation?.kind === 'comparison') {
    return CRITERION_KEYS
      .map((key) => {
        const initial = levelText(key, evaluation.initial[key], t);
        const revised = levelText(key, evaluation.revised[key], t);
        const delta = initial && revised ? evaluation.changes[key] : null;
        return { key, initial, revised, delta };
      })
      .filter((row) => row.initial || row.revised);
  }

  const scores = isPlainObject(feedback?.comparison?.scores) ? feedback.comparison.scores : {};
  const scaled = CRITERION_KEYS
    .map((key) => [key, isPlainObject(scores[key]) ? scores[key] : null])
    .filter(([, data]) => data && scaleOf(data));
  if (scaled.length === 0) {
    return null;
  }
  return scaled
    .map(([key, data]) => {
      const scale = scaleOf(data);
      const asLevel = (level) => (Number.isInteger(level) && level >= scale.min && level <= scale.max
        ? levelText(key, { level, ...scale, stance: null }, t)
        : null);
      const initial = asLevel(data.initial);
      const revised = asLevel(data.revised);
      const delta = initial && revised && Number.isInteger(data.delta) ? data.delta : null;
      return { key, initial, revised, delta };
    })
    .filter((row) => row.initial || row.revised);
}

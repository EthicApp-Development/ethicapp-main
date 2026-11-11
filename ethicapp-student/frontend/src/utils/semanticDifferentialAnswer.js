/**
 * A student's answer to a semantic differential task: a value on the scale
 * and a justification. Shared by the task view and the drafts kept on the
 * device (#1118), so both apply the same rules as the server
 * (ethicapp/backend/controllers/activities/activities-student.js,
 * `submitSemanticDifferentialResponse` and `validateJustification`):
 *
 * - the value is an integer from 1 to the task's `numValues`;
 * - the justification is trimmed, and an empty one counts as none;
 * - a task with `requiresJustification` needs one;
 * - a justification, when there is one, has at least the task's minimum
 *   number of words.
 */

export const ANSWER_PROBLEMS = Object.freeze({
  MISSING_VALUE: 'missingValue',
  MISSING_JUSTIFICATION: 'missingJustification',
  JUSTIFICATION_TOO_SHORT: 'justificationTooShort'
});

export function countWords(text) {
  if (typeof text !== 'string') {
    return 0;
  }

  const normalizedText = text.trim();
  if (normalizedText.length === 0) {
    return 0;
  }

  return normalizedText.split(/\s+/u).length;
}

/**
 * The minimum number of words of a task's justification, or null. The
 * student payload names it `minWordCount`; the other names are older shapes
 * of the same setting.
 */
export function minimumJustificationWords(task) {
  const minimumRequiredCandidates = [
    task?.justificationMinimumLengthRequired,
    task?.justification_minimum_length_required,
    task?.answerFormat?.justificationMinimumLengthRequired,
    task?.answerFormat?.justification_minimum_length_required,
    task?.ansFormat?.justificationMinimumLengthRequired,
    task?.ansFormat?.justification_minimum_length_required,
    task?.ans_format?.justification_minimum_length_required
  ];

  const isMinimumRequired = minimumRequiredCandidates.some((value) => value === true);

  const minimumWordCandidates = [
    task?.min_just_length,
    task?.minWordCount,
    task?.minJustificationWords,
    task?.minimumJustificationWords,
    task?.minJustLength,
    task?.answerFormat?.minJustLength,
    task?.answerFormat?.min_just_length,
    task?.ansFormat?.minJustLength,
    task?.ansFormat?.min_just_length,
    task?.ans_format?.min_just_length
  ];

  const parsedMinimumValues = minimumWordCandidates
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (parsedMinimumValues.length === 0) {
    return null;
  }

  if (isMinimumRequired) {
    return Math.max(...parsedMinimumValues);
  }

  return parsedMinimumValues[0];
}

/**
 * The student's stored answers of a phase (`phase.responses` of full_state),
 * by task id, with `normalizedValue` (an integer or null) and
 * `normalizedJustification` (a string).
 */
export function savedAnswersByTaskId(phase) {
  const responseList = Array.isArray(phase?.responses) ? phase.responses : [];

  return responseList.reduce((acc, response) => {
    const taskId = Number(
      response?.taskId
      ?? response?.task_id
      ?? response?.questionId
      ?? response?.question_id
      ?? response?.did
    );

    if (!Number.isInteger(taskId) || taskId <= 0) {
      return acc;
    }

    const normalizedValue = Number(
      response?.selection
      ?? response?.sel
      ?? response?.value
      ?? response?.responseValue
      ?? response?.response_value
    );

    const normalizedJustification = response?.justification
      ?? response?.comment
      ?? response?.description
      ?? '';

    acc[taskId] = {
      ...response,
      normalizedValue: Number.isInteger(normalizedValue) ? normalizedValue : null,
      normalizedJustification: typeof normalizedJustification === 'string' ? normalizedJustification : ''
    };
    return acc;
  }, {});
}

/**
 * What the task shows: the draft's value and justification where the
 * student changed them, the stored answer's otherwise.
 *
 * @param {{ value?: number, justification?: string }|undefined} draft
 * @param {{ normalizedValue: number|null, normalizedJustification: string }|undefined} saved
 * @returns {{ value: number|null, justification: string }}
 */
export function effectiveAnswer(draft, saved) {
  const value = Number.isInteger(draft?.value)
    ? draft.value
    : (Number.isInteger(saved?.normalizedValue) ? saved.normalizedValue : null);
  const justification = typeof draft?.justification === 'string'
    ? draft.justification
    : (typeof saved?.normalizedJustification === 'string' ? saved.normalizedJustification : '');

  return { value, justification };
}

/** The answer as the server stores it: an integer value or null, a trimmed justification. */
export function normalizeAnswer(answer) {
  return {
    value: Number.isInteger(answer?.value) ? answer.value : null,
    justification: typeof answer?.justification === 'string' ? answer.justification.trim() : ''
  };
}

export function sameAnswer(left, right) {
  const a = normalizeAnswer(left);
  const b = normalizeAnswer(right);
  return a.value === b.value && a.justification === b.justification;
}

export function isEmptyAnswer(answer) {
  const { value, justification } = normalizeAnswer(answer);
  return value === null && justification.length === 0;
}

/**
 * Why the server would refuse this answer to the task, or null when it
 * would accept it.
 *
 * @returns {string|null} One of ANSWER_PROBLEMS.
 */
export function answerProblem(task, answer) {
  const { value, justification } = normalizeAnswer(answer);
  const numValues = Number(task?.numValues);

  if (value === null || value < 1 || (Number.isInteger(numValues) && numValues > 0 && value > numValues)) {
    return ANSWER_PROBLEMS.MISSING_VALUE;
  }

  if (justification.length === 0) {
    return task?.requiresJustification ? ANSWER_PROBLEMS.MISSING_JUSTIFICATION : null;
  }

  const minimumWords = minimumJustificationWords(task);
  if (Number.isInteger(minimumWords) && countWords(justification) < minimumWords) {
    return ANSWER_PROBLEMS.JUSTIFICATION_TOO_SHORT;
  }

  return null;
}

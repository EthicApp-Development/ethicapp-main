import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANSWER_PROBLEMS,
  answerProblem,
  countWords,
  effectiveAnswer,
  isEmptyAnswer,
  minimumJustificationWords,
  normalizeAnswer,
  sameAnswer,
  savedAnswersByTaskId
} from '../semanticDifferentialAnswer.js';

test('counts words as the server does', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords(' una  respuesta\ncon   saltos '), 4);
  assert.equal(countWords(null), 0);
});

test('reads the minimum word count of the student payload', () => {
  assert.equal(minimumJustificationWords({ minWordCount: 5 }), 5);
  assert.equal(minimumJustificationWords({ minWordCount: 0 }), null);
  assert.equal(minimumJustificationWords({}), null);
});

test('maps stored answers by task id', () => {
  const saved = savedAnswersByTaskId({
    responses: [
      { taskId: 3, selection: 2, justification: 'Porque sí' },
      { taskId: 'x', selection: 1 },
      { taskId: 4, selection: null, justification: null }
    ]
  });
  assert.deepEqual(Object.keys(saved), ['3', '4']);
  assert.equal(saved[3].normalizedValue, 2);
  assert.equal(saved[3].normalizedJustification, 'Porque sí');
  assert.equal(saved[4].normalizedValue, null);
  assert.equal(saved[4].normalizedJustification, '');
});

test('fills what the draft did not change from the stored answer', () => {
  const saved = { normalizedValue: 4, normalizedJustification: 'Antes' };
  assert.deepEqual(effectiveAnswer({ justification: 'Ahora' }, saved), { value: 4, justification: 'Ahora' });
  assert.deepEqual(effectiveAnswer({ value: 2 }, saved), { value: 2, justification: 'Antes' });
  assert.deepEqual(effectiveAnswer(undefined, undefined), { value: null, justification: '' });
});

test('compares answers trimmed, as stored', () => {
  assert.equal(sameAnswer({ value: 3, justification: ' Hola ' }, { value: 3, justification: 'Hola' }), true);
  assert.equal(sameAnswer({ value: 3, justification: '' }, { value: 3, justification: null }), true);
  assert.equal(sameAnswer({ value: 3 }, { value: 2 }), false);
  assert.deepEqual(normalizeAnswer({ value: '3', justification: '  x ' }), { value: null, justification: 'x' });
  assert.equal(isEmptyAnswer({ justification: '   ' }), true);
  assert.equal(isEmptyAnswer({ value: 1 }), false);
});

test('finds what the server would refuse', () => {
  const task = { numValues: 5, requiresJustification: true, minWordCount: 3 };

  assert.equal(answerProblem(task, { value: null, justification: 'uno dos tres' }), ANSWER_PROBLEMS.MISSING_VALUE);
  assert.equal(answerProblem(task, { value: 6, justification: 'uno dos tres' }), ANSWER_PROBLEMS.MISSING_VALUE);
  assert.equal(answerProblem(task, { value: 0, justification: 'uno dos tres' }), ANSWER_PROBLEMS.MISSING_VALUE);
  assert.equal(answerProblem(task, { value: 2, justification: '   ' }), ANSWER_PROBLEMS.MISSING_JUSTIFICATION);
  assert.equal(answerProblem(task, { value: 2, justification: 'uno dos' }), ANSWER_PROBLEMS.JUSTIFICATION_TOO_SHORT);
  assert.equal(answerProblem(task, { value: 2, justification: ' uno dos tres ' }), null);
});

test('applies the minimum to an optional justification only when there is one', () => {
  const task = { numValues: 7, requiresJustification: false, minWordCount: 3 };

  assert.equal(answerProblem(task, { value: 7, justification: '' }), null);
  assert.equal(answerProblem(task, { value: 7, justification: 'corta' }), ANSWER_PROBLEMS.JUSTIFICATION_TOO_SHORT);
});

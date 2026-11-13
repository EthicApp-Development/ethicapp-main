import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluationCriteriaPills,
  levelText,
  readArgumentEvaluation,
  v19ComparisonRows
} from '../argumentTutorFeedback.js';
import { argumentEvaluationExample } from './fixtures.mjs';
import { createTranslator } from '../../../../i18n/translator.js';

const t = createTranslator('es_CL');
const tEn = createTranslator('en_US');

// What a student must never read: the evaluation's ids and the model's texts.
function assertNoTeacherOnlyText(value, document) {
  const json = JSON.stringify(value);
  assert.equal(/\b(?:AF|EV|EX)[1-9][0-9]*\b/u.test(json), false, 'no claim type, fact or exclusion id');
  const evaluations = document.kind === 'analysis' ? [document.evaluation] : [document.initial, document.revised];
  for (const evaluation of evaluations) {
    for (const criterion of Object.values(evaluation.criteria)) {
      for (const text of [criterion.fragment, criterion.reason].filter(Boolean)) {
        assert.equal(json.includes(text), false, 'no fragment or reason');
      }
    }
  }
}

test('a v19 analysis shows each level with its scale and the claim with its stance', () => {
  const document = argumentEvaluationExample('analysis-enhanced.es_CL');
  const evaluation = readArgumentEvaluation({ argumentEvaluation: document });

  const pills = evaluationCriteriaPills(evaluation, t);
  assert.deepEqual(pills, [
    { key: 'claim', value: '2 de 2 · En contra' },
    { key: 'evidence', value: '2 de 2' },
    { key: 'warrant', value: '2 de 2' },
    { key: 'qualifier', value: 'Presente' }
  ]);
  assertNoTeacherOnlyText(pills, document);
});

test('an analysis without a claim shows no stance', () => {
  const evaluation = readArgumentEvaluation({ argumentEvaluation: argumentEvaluationExample('analysis-no-claim.es_CL') });

  assert.deepEqual(evaluationCriteriaPills(evaluation, tEn).map((pill) => pill.value),
    ['0 of 2', '0 of 2', '0 of 2', 'Absent']);
});

test('a v19 comparison shows the levels before and after and their change', () => {
  const document = argumentEvaluationExample('comparison.es_CL');

  const rows = v19ComparisonRows({ mode: 'comparison', argumentEvaluation: document }, t);
  assert.deepEqual(rows, [
    { key: 'claim', initial: '1 de 2 · En contra', revised: '2 de 2 · En contra', delta: 1 },
    { key: 'evidence', initial: '1 de 2', revised: '2 de 2', delta: 1 },
    { key: 'warrant', initial: '1 de 2', revised: '2 de 2', delta: 1 },
    { key: 'qualifier', initial: 'Ausente', revised: 'Presente', delta: 1 }
  ]);
  assertNoTeacherOnlyText(rows, document);
});

test('scales come from the payload', () => {
  const document = argumentEvaluationExample('comparison.es_CL');
  document.revised.criteria.evidence.scale = { min: 0, max: 4 };
  document.revised.criteria.evidence.level = 3;

  const rows = v19ComparisonRows({ argumentEvaluation: document }, tEn);
  assert.equal(rows.find((row) => row.key === 'evidence').revised, '3 of 4');
});

test('a level outside its scale is not shown', () => {
  const document = argumentEvaluationExample('comparison.es_CL');
  document.initial.criteria.warrant.level = 7;

  const warrant = v19ComparisonRows({ argumentEvaluation: document }, tEn).find((row) => row.key === 'warrant');
  assert.deepEqual(warrant, { key: 'warrant', initial: null, revised: '2 of 2', delta: null });
});

test('comparison scores that carry their scale are read as v19 levels', () => {
  const feedback = {
    mode: 'comparison',
    comparison: { scores: {
      claim: { initial: 1, revised: 2, delta: 1, min: 0, max: 2 },
      qualifier: { initial: 0, revised: 1, delta: 1, min: 0, max: 1 }
    } }
  };

  assert.deepEqual(v19ComparisonRows(feedback, tEn), [
    { key: 'claim', initial: '1 of 2', revised: '2 of 2', delta: 1 },
    { key: 'qualifier', initial: 'Absent', revised: 'Present', delta: 1 }
  ]);
});

test('a v12 comparison is left to the component as before', () => {
  const feedback = {
    mode: 'comparison',
    comparison: { scores: {
      claim: { initial: 1, revised: 1, delta: 0 },
      evidence: { initial: 1, revised: 3, delta: 2 }
    } }
  };

  assert.equal(v19ComparisonRows(feedback, tEn), null);
  assert.equal(readArgumentEvaluation(feedback), null);
  assert.deepEqual(evaluationCriteriaPills(null, tEn), []);
});

test('levelText reads a two-level scale as present or absent', () => {
  assert.equal(levelText('qualifier', { level: 0, min: 0, max: 1, stance: null }, tEn), 'Absent');
  assert.equal(levelText('claim', { level: 1, min: 0, max: 2, stance: 'conditional' }, tEn), '1 of 2 · Conditional');
  assert.equal(levelText('claim', null, tEn), null);
});

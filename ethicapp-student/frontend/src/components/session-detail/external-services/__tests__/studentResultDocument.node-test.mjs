import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comparisonTrendKey,
  criterionMeter,
  normalizeStudentResultDocument,
  normalizeStudentResultSection,
  studentResultStatusKey
} from '../student-result/studentResultDocument.js';
import { EXAMPLE_NAMES, studentResultExample } from './fixtures.mjs';

// Plain text: markup, tags, entities and indentation stay as they are.
const PLAIN = '**not bold** <b>x</b> &amp;\n  indented';

const BASE = {
  schemaVersion: 'student-result/v1',
  locale: 'en-US',
  title: 'Feedback',
  sections: []
};

test('every contract example normalizes to a document with sections', () => {
  for (const name of EXAMPLE_NAMES) {
    const example = studentResultExample(name);
    const normalized = normalizeStudentResultDocument(example);
    assert.ok(normalized, name);
    assert.equal(normalized.title, example.title, name);
    assert.equal(normalized.lang, example.locale, name);
    assert.equal(normalized.status, 'complete', name);
    assert.ok(normalized.sections.length > 0, name);
  }
});

test('a criteria section keeps label, value, meter and description of each criterion', () => {
  const example = studentResultExample('tutor-analysis.es_CL');
  const normalized = normalizeStudentResultDocument(example);

  assert.equal(normalized.summary, example.summary);
  assert.equal(normalized.overview, example.overview);
  assert.deepEqual(
    normalized.sections.map((section) => section.kind),
    ['criteria', 'bullets', 'text']
  );

  const [criteria] = normalized.sections;
  assert.equal(criteria.title, 'Criterios');
  assert.deepEqual(criteria.items.map((item) => [item.key, item.label, item.value]), [
    ['claim', 'Afirmación', 'En contra'],
    ['evidence', 'Evidencia', '2 de 3'],
    ['warrant', 'Garantía', '1 de 3'],
    ['qualifier', 'Calificador', '2 de 3']
  ]);
  assert.equal(criteria.items[0].meter, null, 'a criterion without score has no meter');
  assert.deepEqual(criteria.items[1].meter, { score: 2, min: 1, max: 3, fraction: 0.5 });
  assert.equal(criteria.items[2].meter.fraction, 0);
  criteria.items.forEach((item, index) => {
    assert.equal(item.description, example.sections[0].items[index].description);
  });
});

test('bullets and text sections keep their plain text as it is, line breaks included', () => {
  const example = studentResultExample('tutor-analysis.en_US');
  const [, bullets, text] = normalizeStudentResultDocument(example).sections;

  assert.deepEqual(
    bullets,
    { kind: 'bullets', title: 'Comments', items: example.sections[1].items }
  );
  assert.deepEqual(text, { kind: 'text', title: 'Your argument', text: example.sections[2].text });
  assert.match(text.text, /\n/);

  assert.deepEqual(
    normalizeStudentResultSection({ kind: 'text', text: PLAIN }),
    { kind: 'text', title: null, text: PLAIN }
  );
});

test('a comparison section keeps before, after and the trend of each item', () => {
  const normalized = normalizeStudentResultDocument(studentResultExample('tutor-comparison.en_US'));
  const [comparison] = normalized.sections;

  assert.deepEqual(
    normalized.sections.map((section) => section.kind),
    ['comparison', 'criteria', 'bullets', 'text', 'text']
  );
  assert.equal(comparison.title, 'Changes from your previous argument');
  assert.deepEqual(comparison.items, [
    { key: 'claim', label: 'Claim', before: 'Against', after: 'Against', trend: null },
    { key: 'evidence', label: 'Evidence', before: '2 of 3', after: '3 of 3', trend: 'improved' },
    { key: 'warrant', label: 'Warrant', before: '1 of 3', after: '2 of 3', trend: 'improved' },
    { key: 'qualifier', label: 'Qualifier', before: '2 of 3', after: '2 of 3', trend: 'unchanged' }
  ]);
  assert.deepEqual(
    normalizeStudentResultSection({
      kind: 'comparison',
      items: [{ label: 'A', before: '1', after: '2', trend: 'better' }]
    })
      .items[0].trend,
    null
  );
});

test('sections of an unknown kind are skipped and the others kept in order', () => {
  const example = studentResultExample('unknown-section-kind.en_US');
  const normalized = normalizeStudentResultDocument(example);
  assert.deepEqual(normalized.sections, [
    { kind: 'text', title: 'Your response', text: 'Honesty matters more than a grade.' }
  ]);

  const mixed = normalizeStudentResultDocument({
    ...BASE,
    sections: [
      { kind: 'timeline', items: [] },
      { kind: 'bullets', items: ['One'] },
      { kind: 'toString' },
      { kind: '__proto__' },
      { kind: 'constructor', items: ['x'] },
      null,
      'text',
      { kind: 'text', text: 'Two' }
    ]
  });
  assert.deepEqual(mixed.sections.map((section) => section.kind), ['bullets', 'text']);
});

test('drops malformed items and sections with nothing to show', () => {
  assert.equal(normalizeStudentResultSection({ kind: 'criteria', items: [] }), null);
  assert.equal(
    normalizeStudentResultSection({ kind: 'criteria', items: [{ key: 'a', label: 'A' }] }),
    null
  );
  assert.equal(normalizeStudentResultSection({ kind: 'bullets', items: ['  ', 3] }), null);
  assert.equal(normalizeStudentResultSection({ kind: 'text', text: '   ' }), null);
  assert.equal(
    normalizeStudentResultSection({ kind: 'comparison', items: [{ label: 'A', before: '1' }] }),
    null
  );

  const criteria = normalizeStudentResultSection({
    kind: 'criteria',
    title: ' ',
    items: [{ key: 'a', label: 'A', value: '1', description: ' ' }, 'x', { label: 'B', value: '2' }]
  });
  assert.equal(criteria.title, null);
  assert.deepEqual(criteria.items, [
    { key: 'a', label: 'A', value: '1', meter: null, description: null },
    { key: null, label: 'B', value: '2', meter: null, description: null }
  ]);
});

test('only a student-result/v1 document with a title is a document', () => {
  assert.equal(normalizeStudentResultDocument(null), null);
  assert.equal(normalizeStudentResultDocument([BASE]), null);
  assert.equal(
    normalizeStudentResultDocument({ ...BASE, schemaVersion: 'student-result/v2' }),
    null
  );
  assert.equal(normalizeStudentResultDocument({ ...BASE, title: ' ' }), null);
  assert.equal(
    normalizeStudentResultDocument({ feedback: { summary: 'Legacy tutor payload' } }),
    null
  );

  const loose = normalizeStudentResultDocument({
    ...BASE, locale: 'fr-FR', sections: 'x', summary: 4
  });
  assert.deepEqual(loose, {
    lang: null, title: 'Feedback', summary: null, overview: null, status: 'complete', sections: []
  });
});

test('status: complete by default, and words from the app for the others', () => {
  assert.equal(normalizeStudentResultDocument(BASE).status, 'complete');
  assert.equal(normalizeStudentResultDocument({ ...BASE, status: 'partial' }).status, 'partial');
  assert.equal(
    normalizeStudentResultDocument({ ...BASE, status: 'unavailable' }).status,
    'unavailable'
  );
  assert.equal(normalizeStudentResultDocument({ ...BASE, status: 'failed' }).status, 'complete');

  assert.equal(studentResultStatusKey('complete'), null);
  assert.equal(studentResultStatusKey('partial'), 'sessionDetail.studentResultStatusPartial');
  assert.equal(
    studentResultStatusKey('unavailable'),
    'sessionDetail.studentResultStatusUnavailable'
  );
  assert.equal(studentResultStatusKey('toString'), null);

  assert.equal(comparisonTrendKey('improved'), 'sessionDetail.studentResultTrendImproved');
  assert.equal(comparisonTrendKey('unchanged'), 'sessionDetail.studentResultTrendUnchanged');
  assert.equal(comparisonTrendKey('declined'), 'sessionDetail.studentResultTrendDeclined');
  assert.equal(comparisonTrendKey(null), null);
});

test('criterionMeter needs a score inside its range', () => {
  assert.deepEqual(
    criterionMeter({ score: 3, maxScore: 4 }),
    { score: 3, min: 0, max: 4, fraction: 0.75 }
  );
  assert.deepEqual(
    criterionMeter({ score: 3, minScore: 1, maxScore: 3 }),
    { score: 3, min: 1, max: 3, fraction: 1 }
  );
  assert.equal(criterionMeter({ score: 2 }), null);
  assert.equal(criterionMeter({ score: 5, maxScore: 4 }), null);
  assert.equal(criterionMeter({ score: 0, minScore: 1, maxScore: 3 }), null);
  assert.equal(criterionMeter({ score: 1, minScore: 3, maxScore: 3 }), null);
  assert.equal(criterionMeter({ score: '2', maxScore: 3 }), null);
  assert.equal(criterionMeter({ score: 2, minScore: null, maxScore: 3 }), null);
});

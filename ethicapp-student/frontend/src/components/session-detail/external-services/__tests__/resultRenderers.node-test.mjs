import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import enUS from '../../../../i18n/locales/en_US.js';
import esCL from '../../../../i18n/locales/es_CL.js';
import {
  RENDERERS,
  resolveResultHeading,
  resolveResultRenderer,
  resolveResultView
} from '../resultRenderers.js';
import { studentResultExample } from './fixtures.mjs';

const t = (key) => `t(${key})`;
const STUDENT_RESULT = { documentSchema: 'student-result/v1' };
const CHAT_FEEDBACK = { componentId: 'argument-tutor-chat-feedback' };

test('student-result/v1 resolves to the generic renderer', () => {
  assert.equal(
    resolveResultRenderer({ documentSchema: 'student-result/v1' }),
    RENDERERS.studentResult
  );
  assert.equal(
    resolveResultRenderer({ documentSchema: ' student-result/v1 ' }),
    RENDERERS.studentResult
  );
});

test('an unknown document schema resolves to no renderer', () => {
  assert.equal(resolveResultRenderer({ documentSchema: 'student-result/v2' }), null);
  assert.equal(resolveResultRenderer({ documentSchema: 'claim-typology/v1' }), null);
  assert.equal(resolveResultRenderer({ documentSchema: 'toString' }), null);
  assert.equal(resolveResultRenderer({ documentSchema: '__proto__' }), null);
  // A document schema decides alone: its payload is a document of that schema.
  assert.equal(
    resolveResultRenderer({ documentSchema: 'quiz/v1', componentId: 'argument-tutor-report' }),
    null
  );
  assert.equal(
    resolveResultRenderer({ documentSchema: 'student-result/v1', componentId: 'unknown' }),
    RENDERERS.studentResult
  );
});

test('a legacy componentId resolves through the transition registry', () => {
  assert.equal(
    resolveResultRenderer({ componentId: 'argument-tutor-chat-feedback' }),
    RENDERERS.argumentTutorChatFeedback
  );
  assert.equal(
    resolveResultRenderer({ componentId: 'argument-tutor-report' }),
    RENDERERS.argumentTutorReport
  );
  assert.equal(resolveResultRenderer({ componentId: 'unknown-component' }), null);
  assert.equal(resolveResultRenderer({ componentId: 'constructor' }), null);
});

test('a component URL never resolves to a renderer, and nothing else falls back', () => {
  assert.equal(
    resolveResultRenderer({ url: 'https://example.test/component.js', exportName: 'default' }),
    null
  );
  assert.equal(
    resolveResultRenderer({ componentId: 'x', url: 'https://example.test/component.js' }),
    null
  );
  assert.equal(resolveResultRenderer({}), null);
  assert.equal(resolveResultRenderer(undefined), null);
  assert.equal(resolveResultRenderer('student-result/v1'), null);
});

test('resolveResultView normalizes a document; a payload that is none gets the notice', () => {
  const payload = studentResultExample('tutor-analysis.en_US');
  const view = resolveResultView({ component: { documentSchema: 'student-result/v1' }, payload });
  assert.equal(view.renderer, RENDERERS.studentResult);
  assert.equal(view.resultDocument.title, 'Feedback on your argument');
  assert.equal(view.resultDocument.lang, 'en-US');

  assert.deepEqual(
    resolveResultView({ component: STUDENT_RESULT, payload: { feedback: {} } }),
    { renderer: null }
  );
  assert.deepEqual(
    resolveResultView({ component: { documentSchema: 'quiz-result/v1' }, payload }),
    { renderer: null }
  );
  assert.deepEqual(
    resolveResultView({ component: CHAT_FEEDBACK, payload: { feedback: {} } }),
    { renderer: RENDERERS.argumentTutorChatFeedback }
  );
});

test('resolveResultHeading uses the document title, the legacy titles or the generic one', () => {
  const documentResult = {
    component: { documentSchema: 'student-result/v1', title: 'Service name' },
    payload: studentResultExample('tutor-comparison.es_CL')
  };
  assert.deepEqual(
    resolveResultHeading(resolveResultView(documentResult), documentResult, t),
    { text: 'Retroalimentación sobre tu argumento revisado', lang: 'es-CL' }
  );

  const chat = { component: { ...CHAT_FEEDBACK, title: 'Argument Tutor Feedback' } };
  assert.deepEqual(resolveResultHeading(resolveResultView(chat), chat, t),
    { text: 't(sessionDetail.atsFeedbackTitle)', lang: null });

  const report = { component: { componentId: 'argument-tutor-report', title: 'Mock report' } };
  assert.deepEqual(
    resolveResultHeading(resolveResultView(report), report, t),
    { text: 'Mock report', lang: null }
  );
  const untitled = { component: { componentId: 'argument-tutor-report' } };
  assert.deepEqual(resolveResultHeading(resolveResultView(untitled), untitled, t),
    { text: 't(sessionDetail.externalResultTitle)', lang: null });

  const unknown = { component: { documentSchema: 'quiz-result/v1', title: 'Quiz service' } };
  assert.deepEqual(resolveResultHeading(resolveResultView(unknown), unknown, t),
    { text: 't(sessionDetail.externalResultTitle)', lang: null });
});

test('both locales define every string of the result renderers', () => {
  const keys = [
    'externalResultTitle',
    'externalResultLoadError',
    'studentResultUnsupported',
    'studentResultStatusPartial',
    'studentResultStatusUnavailable',
    'studentResultOverviewToggle',
    'studentResultCriterionHelp',
    'studentResultBefore',
    'studentResultAfter',
    'studentResultTrendImproved',
    'studentResultTrendUnchanged',
    'studentResultTrendDeclined'
  ];
  for (const [name, locale] of [['en_US', enUS], ['es_CL', esCL]]) {
    for (const key of keys) {
      assert.equal(typeof locale.sessionDetail[key], 'string', `${name}: sessionDetail.${key}`);
      assert.ok(locale.sessionDetail[key].trim(), `${name}: sessionDetail.${key}`);
    }
  }
});

// No code path loads a module at run time (#1132): the app imports only
// what it bundles, so nothing a result carries can become code.
const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DYNAMIC_IMPORT = /\bimport\s*\(/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path);
    }
    return /\.(?:js|jsx|mjs)$/.test(entry.name) ? [path] : [];
  });
}

// The source without its comments, so a JSDoc type such as
// {import('axios').AxiosInstance} does not count.
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('no source file imports a module at run time', () => {
  const files = sourceFiles(SOURCE_ROOT);
  assert.ok(files.some((file) => file.endsWith('ExternalServiceResultPanel.jsx')));
  const offenders = files
    .filter((file) => DYNAMIC_IMPORT.test(withoutComments(readFileSync(file, 'utf8'))))
    .map((file) => relative(SOURCE_ROOT, file));
  assert.deepEqual(offenders, []);
});

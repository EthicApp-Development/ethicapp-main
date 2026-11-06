import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { errorLogDetails, socketEventLogDetails } from '../logDetails.js';

const STUDENT_TEXT = 'My argument quotes the case and names my classmate.';

test('socketEventLogDetails keeps the session and the ids a result names', () => {
  const details = socketEventLogDetails(3, {
    userId: 7,
    sessionId: 3,
    phaseId: 20,
    questionId: 30,
    resultId: '0c6f1d2e-5a3b-4f7e-9d1c-2b8a7e6f5d4c',
    serviceId: 'argumentation-tutor-system',
    component: { componentId: 'argument-tutor-chat-feedback', title: 'Argument Tutor Feedback' },
    payload: { feedback: { argument: STUDENT_TEXT, summary: STUDENT_TEXT } },
    message: 'Your argument tutor feedback is now available.',
    status: 'completed'
  });

  assert.deepEqual(details, {
    sessionId: 3,
    resultId: '0c6f1d2e-5a3b-4f7e-9d1c-2b8a7e6f5d4c',
    serviceId: 'argumentation-tutor-system',
    phaseId: 20,
    questionId: 30
  });
});

test('socketEventLogDetails drops shared responses and text in id fields', () => {
  assert.deepEqual(socketEventLogDetails(3, { content: STUDENT_TEXT }), { sessionId: 3 });
  assert.deepEqual(
    socketEventLogDetails(3, { resultId: STUDENT_TEXT, phaseId: 'phase two' }),
    { sessionId: 3 }
  );
  assert.deepEqual(socketEventLogDetails('x', [STUDENT_TEXT]), { sessionId: null });
  assert.deepEqual(socketEventLogDetails(3), { sessionId: 3 });
});

test('errorLogDetails keeps the name, code and status of an error', () => {
  const error = Object.assign(new Error(`Request failed: ${STUDENT_TEXT}`), {
    name: 'AxiosError',
    code: 'ERR_BAD_REQUEST',
    config: { data: JSON.stringify({ answer: STUDENT_TEXT }) },
    response: { status: 422, data: { error: STUDENT_TEXT } }
  });

  assert.deepEqual(
    errorLogDetails(error),
    { name: 'AxiosError', code: 'ERR_BAD_REQUEST', status: 422 }
  );
  assert.deepEqual(
    errorLogDetails(new TypeError('x')),
    { name: 'TypeError', code: null, status: null }
  );
  assert.deepEqual(errorLogDetails(undefined), { name: null, code: null, status: null });
});

// Every console call of the app, outside tests: what each one passes, with
// the two helpers' calls taken out, must not name a payload, a response, a
// result or a raw error (#1139).
const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONSOLE_CALL = /console\.(?:debug|log|info|warn|error|trace|dir|table)\s*\(/g;
const HELPER_CALL = /\b(?:socketEventLogDetails|errorLogDetails)\s*\(/g;
const FORBIDDEN = /\b(?:payload|error|err|data|body|response|results?|content|feedback|message)\b/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path);
    }
    return /\.(?:js|jsx|mjs)$/.test(entry.name) ? [path] : [];
  });
}

// The text between the parenthesis at `start` and its match.
function callArguments(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  throw new Error('Unbalanced console call.');
}

function withoutHelperCalls(text) {
  let result = text;
  let match;
  HELPER_CALL.lastIndex = 0;
  while ((match = HELPER_CALL.exec(result))) {
    const open = match.index + match[0].length - 1;
    const inner = callArguments(result, open);
    result = `${result.slice(0, match.index)}helper${result.slice(open + inner.length + 2)}`;
    HELPER_CALL.lastIndex = 0;
  }
  return result;
}

// String literals and template text are log labels; expressions inside a
// template are kept.
function withoutStringText(text) {
  return text
    .replace(/'(?:[^'\\]|\\.)*'/g, '\'\'')
    .replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, '``')
    .replace(/`[^`]*`/g, (template) => [...template.matchAll(/\$\{([^}]*)\}/g)]
      .map((expression) => expression[1])
      .join(' '));
}

test('no console call in the student app receives server data', () => {
  const offending = [];

  sourceFiles(SOURCE_ROOT).forEach((file) => {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(CONSOLE_CALL)) {
      const open = match.index + match[0].length - 1;
      const args = withoutStringText(withoutHelperCalls(callArguments(source, open)));
      if (FORBIDDEN.test(args)) {
        const shown = args.trim().replace(/\s+/g, ' ');
        offending.push(`${relative(SOURCE_ROOT, file)}: ${match[0]}${shown})`);
      }
    }
  });

  assert.deepEqual(offending, []);
});

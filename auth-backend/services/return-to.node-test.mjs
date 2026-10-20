import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendReturnTo,
  getPostLoginRedirect,
  resolvePostLoginRedirect,
  sanitizeReturnTo
} from './return-to.js';

test('internal paths under the allowlist are accepted and normalized', () => {
  assert.equal(sanitizeReturnTo('/student/?join=abc123'), '/student/?join=abc123');
  assert.equal(sanitizeReturnTo('/student/sessions/57'), '/student/sessions/57');
  assert.equal(sanitizeReturnTo('/student/./sessions/57'), '/student/sessions/57');
});

test('external, protocol-relative and scheme targets are rejected', () => {
  for (const value of [
    'https://evil.example/student/',
    'http://localhost/student/',
    '//evil.example/student/',
    'javascript:alert(1)',
    'student/',
    ' /student/'
  ]) {
    assert.equal(sanitizeReturnTo(value), null, value);
  }
});

test('backslashes, control characters and encoded separators are rejected', () => {
  for (const value of [
    '/\\evil.example',
    '/student\\..\\mng/',
    '/student/\n',
    '/student/%2e%2e/mng/',
    '/student/..%2fmng/',
    '/student/..%5Cmng/',
    '/student/%2E%2E/mng/'
  ]) {
    assert.equal(sanitizeReturnTo(value), null, JSON.stringify(value));
  }
});

test('paths outside the allowlist, including through dot segments, are rejected', () => {
  for (const value of ['/mng/', '/home', '/student', '/studentx/', '/student/../mng/', '/auth/login', '/']) {
    assert.equal(sanitizeReturnTo(value), null, value);
  }
});

test('non-string, empty and oversized values are rejected', () => {
  for (const value of [undefined, null, 42, {}, ['/student/'], '', `/student/${'a'.repeat(600)}`]) {
    assert.equal(sanitizeReturnTo(value), null);
  }
});

test('a valid target is used only within the user role scope', () => {
  assert.equal(resolvePostLoginRedirect('A', '/student/?join=abc123'), '/student/?join=abc123');
  assert.equal(resolvePostLoginRedirect('P', '/student/?join=abc123'), '/home');
  assert.equal(resolvePostLoginRedirect('S', '/student/?join=abc123'), '/mng');
});

test('invalid or missing targets fall back to the role-based destination', () => {
  assert.equal(resolvePostLoginRedirect('A', undefined), '/student');
  assert.equal(resolvePostLoginRedirect('A', 'https://evil.example/'), '/student');
  assert.equal(resolvePostLoginRedirect('A', '/mng/'), '/student');
  assert.equal(resolvePostLoginRedirect('P', '//evil.example'), '/home');
  assert.equal(getPostLoginRedirect('X'), '/login');
});

test('appendReturnTo adds only valid targets, encoded', () => {
  assert.equal(
    appendReturnTo('https://ethicapp.test/auth/reset-password?token=t1', '/student/?join=abc123'),
    'https://ethicapp.test/auth/reset-password?token=t1&returnTo=%2Fstudent%2F%3Fjoin%3Dabc123'
  );
  assert.equal(appendReturnTo('/auth/login', '/student/sessions/57'), '/auth/login?returnTo=%2Fstudent%2Fsessions%2F57');
  assert.equal(appendReturnTo('/auth/login?confirmed=1', '//evil.example'), '/auth/login?confirmed=1');
  assert.equal(appendReturnTo('/auth/login', undefined), '/auth/login');
});

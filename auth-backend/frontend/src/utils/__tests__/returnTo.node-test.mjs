import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReturnTo, withReturnTo } from '../returnTo.js';

test('readReturnTo keeps root-relative values and drops anything else', () => {
  assert.equal(readReturnTo(new URLSearchParams('returnTo=%2Fstudent%2F%3Fjoin%3Dabc123')), '/student/?join=abc123');
  assert.equal(readReturnTo(new URLSearchParams('returnTo=%2F%2Fevil.example')), '');
  assert.equal(readReturnTo(new URLSearchParams('returnTo=https%3A%2F%2Fevil.example')), '');
  assert.equal(readReturnTo(new URLSearchParams('')), '');
  assert.equal(readReturnTo(undefined), '');
});

test('withReturnTo appends the encoded target only when there is one', () => {
  assert.equal(withReturnTo('/forgot', '/student/?join=abc123'), '/forgot?returnTo=%2Fstudent%2F%3Fjoin%3Dabc123');
  assert.equal(withReturnTo('/login?notice=password_changed', '/student/'), '/login?notice=password_changed&returnTo=%2Fstudent%2F');
  assert.equal(withReturnTo('/register', ''), '/register');
});

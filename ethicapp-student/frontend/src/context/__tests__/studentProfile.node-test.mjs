import assert from 'node:assert/strict';
import test from 'node:test';
import { toStudentUser, USER_PLACEHOLDER } from '../studentProfile.js';

test('the profile keeps the saved preferred_locale', () => {
  const user = toStudentUser({
    success: true,
    data: { id: 44, firstname: 'Ana', lastname: 'Pérez', name: 'Ana P', email: 'ana@example.test', preferred_locale: 'es_CL' }
  });

  assert.deepEqual(user, {
    id: 44,
    firstname: 'Ana',
    lastname: 'Pérez',
    name: 'Ana P',
    email: 'ana@example.test',
    preferredLocale: 'es_CL'
  });
});

test('missing fields fall back to the placeholder values', () => {
  assert.deepEqual(toStudentUser(undefined), { ...USER_PLACEHOLDER });
  assert.deepEqual(toStudentUser({ data: { id: 44 } }), { ...USER_PLACEHOLDER, id: 44 });
});

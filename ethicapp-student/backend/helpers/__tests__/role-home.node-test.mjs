import assert from 'node:assert/strict';
import test from 'node:test';
import { getRoleHome } from '../role-home.js';

test('each known role has the home auth-backend sends it to after login', () => {
  assert.equal(getRoleHome('A'), '/student');
  assert.equal(getRoleHome('P'), '/home');
  assert.equal(getRoleHome('S'), '/mng');
});

test('unknown or missing roles have no home', () => {
  for (const role of ['X', 'a', '', null, undefined, 'toString', '__proto__']) {
    assert.equal(getRoleHome(role), null, String(role));
  }
});

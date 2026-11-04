import assert from 'node:assert/strict';
import test from 'node:test';
import { homeForRole, nonStudentHome } from '../roleHome.js';

test('professors and administrators have a home outside the student app', () => {
  assert.equal(homeForRole('P'), '/home');
  assert.equal(homeForRole('S'), '/mng');
});

test('students and unknown roles stay in the student app', () => {
  assert.equal(homeForRole('A'), null);
  assert.equal(homeForRole(null), null);
  assert.equal(homeForRole(undefined), null);
  assert.equal(homeForRole(''), null);
  assert.equal(homeForRole('p'), null);
  assert.equal(homeForRole('toString'), null);
});

test('only a signed-in session is sent away', () => {
  assert.equal(nonStudentHome({ isAuthenticated: true, uid: 7, role: 'P' }), '/home');
  assert.equal(nonStudentHome({ isAuthenticated: true, uid: 1, role: 'S' }), '/mng');
  assert.equal(nonStudentHome({ isAuthenticated: true, uid: 9, role: 'A' }), null);
  assert.equal(nonStudentHome({ isAuthenticated: false, uid: null, role: 'P' }), null);
  assert.equal(nonStudentHome({ isAuthenticated: false, uid: null, role: null }), null);
  assert.equal(nonStudentHome(null), null);
  assert.equal(nonStudentHome(undefined), null);
});

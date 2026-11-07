import assert from 'node:assert/strict';
import test from 'node:test';
import { isPhaseAnonymous } from '../phaseAnonymity.js';

test("the phase's features.anonymity makes it anonymous without the group context (#1166)", () => {
  assert.equal(isPhaseAnonymous({ features: { anonymity: true } }), true);
  assert.equal(isPhaseAnonymous({ features: { anonymity: true }, groupAnonymous: undefined }), true);
});

test('the group context from user_group makes it anonymous too', () => {
  assert.equal(isPhaseAnonymous({ features: { anonymity: false }, groupAnonymous: true }), true);
  assert.equal(isPhaseAnonymous({ groupAnonymous: true }), true);
});

test('an identified phase is not anonymous', () => {
  assert.equal(isPhaseAnonymous({ features: { anonymity: false }, groupAnonymous: false }), false);
  assert.equal(isPhaseAnonymous({ features: { anonymity: false } }), false);
});

test('a phase without features or group context is not anonymous', () => {
  assert.equal(isPhaseAnonymous({}), false);
  assert.equal(isPhaseAnonymous(null), false);
  assert.equal(isPhaseAnonymous(undefined), false);
});

test('only true counts, not truthy values', () => {
  assert.equal(isPhaseAnonymous({ features: { anonymity: 'true' } }), false);
  assert.equal(isPhaseAnonymous({ features: { anonymity: 1 }, groupAnonymous: 1 }), false);
});

test('the features.anonymous name the backend never sends does not count', () => {
  assert.equal(isPhaseAnonymous({ features: { anonymous: true } }), false);
});

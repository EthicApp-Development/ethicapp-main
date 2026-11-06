import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultExpandedResultKey,
  isExternalResultExpanded,
  toggleExternalResult
} from '../externalResultsExpansion.js';

// Newest first, as groupExternalResultsByPhase returns them.
const byPhaseId = {
  10: [{ key: 'result:2' }, { key: 'result:1' }],
  20: [{ key: 'result:4' }, { key: 'result:3' }]
};

test('the newest result of the current phase is expanded by default', () => {
  assert.equal(defaultExpandedResultKey(byPhaseId, 20), 'result:4');
  assert.equal(defaultExpandedResultKey(byPhaseId, '20'), 'result:4');
});

test('nothing is expanded by default without a current phase or its results', () => {
  assert.equal(defaultExpandedResultKey(byPhaseId, null), null);
  assert.equal(defaultExpandedResultKey(byPhaseId, 30), null);
  assert.equal(defaultExpandedResultKey({}, 20), null);
});

test('every other result, of any phase, starts collapsed', () => {
  const defaultKey = defaultExpandedResultKey(byPhaseId, 20);
  const expanded = Object.values(byPhaseId)
    .flat()
    .filter((result) => isExternalResultExpanded({}, result.key, defaultKey))
    .map((result) => result.key);

  assert.deepEqual(expanded, ['result:4']);
});

test('the student collapses the default result and expands another one', () => {
  const defaultKey = 'result:4';
  let toggles = {};

  toggles = toggleExternalResult(toggles, 'result:4', defaultKey);
  assert.equal(isExternalResultExpanded(toggles, 'result:4', defaultKey), false);

  toggles = toggleExternalResult(toggles, 'result:1', defaultKey);
  assert.equal(isExternalResultExpanded(toggles, 'result:1', defaultKey), true);

  toggles = toggleExternalResult(toggles, 'result:1', defaultKey);
  assert.equal(isExternalResultExpanded(toggles, 'result:1', defaultKey), false);
});

test('a newer result is expanded; the previous default collapses unless toggled', () => {
  const toggles = toggleExternalResult({}, 'result:3', 'result:4');
  const newDefault = 'result:5';

  assert.equal(isExternalResultExpanded(toggles, 'result:5', newDefault), true);
  assert.equal(isExternalResultExpanded(toggles, 'result:4', newDefault), false);
  assert.equal(isExternalResultExpanded(toggles, 'result:3', newDefault), true);
});

test('toggling without a key changes nothing', () => {
  const toggles = { 'result:1': true };

  assert.equal(toggleExternalResult(toggles, '', 'result:1'), toggles);
  assert.equal(isExternalResultExpanded({}, '', null), false);
});

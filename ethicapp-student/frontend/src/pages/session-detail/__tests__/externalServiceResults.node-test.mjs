import assert from 'node:assert/strict';
import test from 'node:test';
import {
  externalResultKey,
  groupExternalResultsByPhase,
  liveExternalResult,
  loadedExternalResults,
  mergeExternalResults,
  unseenExternalResults
} from '../externalServiceResults.js';

const component = { componentId: 'argument-tutor-chat-feedback', title: 'Argument Tutor Feedback' };

function liveEvent(overrides = {}) {
  return {
    userId: 7,
    sessionId: 3,
    phaseId: 20,
    questionId: 30,
    resultId: '101',
    component,
    payload: { feedback: { summary: 'S' } },
    message: 'Your argument tutor feedback is now available.',
    status: 'completed',
    serviceId: 'argumentation-tutor-system',
    receivedAt: '2026-11-05T10:00:01.000Z',
    ...overrides
  };
}

function routeEntry(overrides = {}) {
  return {
    serviceId: 'argumentation-tutor-system',
    resultId: '101',
    phaseId: 20,
    questionId: 30,
    component,
    payload: { feedback: { summary: 'S' } },
    message: 'Your argument tutor feedback is now available.',
    status: 'completed',
    publishedAt: '2026-11-05T10:00:00.000Z',
    ...overrides
  };
}

test('a result is keyed by its resultId, as a string', () => {
  assert.equal(externalResultKey({ resultId: '101' }), 'result:101');
  assert.equal(externalResultKey({ resultId: 101 }), 'result:101');
  assert.equal(externalResultKey({ resultId: ' 101 ' }), 'result:101');
  assert.equal(externalResultKey({ resultId: null, localId: 'abc' }), 'local:abc');
  assert.equal(externalResultKey({}), '');
});

test('an event without resultId keeps a browser-made id', () => {
  const entry = liveExternalResult(liveEvent({ resultId: undefined }), () => 'browser-1');

  assert.equal(entry.resultId, null);
  assert.equal(entry.localId, 'browser-1');
  assert.equal(entry.key, 'local:browser-1');
  assert.equal(liveExternalResult(null), null);
});

test('route entries without a resultId are left out', () => {
  const entries = loadedExternalResults([routeEntry(), routeEntry({ resultId: null }), null, 'x']);

  assert.deepEqual(entries.map((entry) => entry.key), ['result:101']);
  assert.deepEqual(loadedExternalResults(undefined), []);
});

test('a live result and its loaded copy are shown once, whichever comes first', () => {
  const live = liveExternalResult(liveEvent());
  const loaded = loadedExternalResults([routeEntry()]);

  const liveFirst = mergeExternalResults(mergeExternalResults([], [live]), loaded);
  const loadedFirst = mergeExternalResults(mergeExternalResults([], loaded), [live]);

  for (const results of [liveFirst, loadedFirst]) {
    assert.equal(results.length, 1);
    assert.equal(results[0].key, 'result:101');
    assert.equal(results[0].publishedAt, '2026-11-05T10:00:00.000Z');
    assert.equal(results[0].receivedAt, '2026-11-05T10:00:01.000Z');
    assert.equal(results[0].arrival, 1);
  }
});

test('a numeric resultId in the event matches the string id of the route', () => {
  const results = mergeExternalResults(
    mergeExternalResults([], [liveExternalResult(liveEvent({ resultId: 101 }))]),
    loadedExternalResults([routeEntry({ resultId: '101' })])
  );

  assert.equal(results.length, 1);
});

test('events without resultId are never merged with each other', () => {
  let counter = 0;
  const makeId = () => `browser-${++counter}`;
  const results = mergeExternalResults([], [
    liveExternalResult(liveEvent({ resultId: null }), makeId),
    liveExternalResult(liveEvent({ resultId: null }), makeId)
  ]);

  assert.equal(results.length, 2);
});

test('a load never drops a result it does not list', () => {
  const live = liveExternalResult(liveEvent({ resultId: '102' }));
  const local = liveExternalResult(liveEvent({ resultId: null }), () => 'browser-1');
  const shown = mergeExternalResults([], [live, local]);

  const loaded = loadedExternalResults([routeEntry({ resultId: '101' })]);
  const afterLoad = mergeExternalResults(shown, loaded);

  assert.deepEqual(
    afterLoad.map((result) => result.key),
    ['result:102', 'local:browser-1', 'result:101']
  );
});

test('merging nothing new keeps the same list', () => {
  const shown = mergeExternalResults([], loadedExternalResults([routeEntry()]));

  assert.equal(mergeExternalResults(shown, []), shown);
  assert.equal(mergeExternalResults(shown, undefined), shown);
});

test('unseenExternalResults lists each result not shown before once', () => {
  const known = new Set(['result:101']);
  const unseen = unseenExternalResults(known, loadedExternalResults([
    routeEntry({ resultId: '101' }),
    routeEntry({ resultId: '102' }),
    routeEntry({ resultId: '102' })
  ]));

  assert.deepEqual(unseen.map((result) => result.key), ['result:102']);
  assert.deepEqual([...known], ['result:101']);
});

test('results are grouped by phase, newest first, without session-level results', () => {
  const results = mergeExternalResults([], [
    ...loadedExternalResults([
      routeEntry({ resultId: '1', phaseId: 20, publishedAt: '2026-11-05T10:00:00.000Z' }),
      routeEntry({ resultId: '2', phaseId: 21, publishedAt: '2026-11-05T11:00:00.000Z' }),
      routeEntry({ resultId: '3', phaseId: 20, publishedAt: '2026-11-05T10:05:00.000Z' }),
      routeEntry({ resultId: '4', phaseId: 0 })
    ]),
    liveExternalResult(liveEvent({ resultId: '5', phaseId: null }))
  ]);

  const byPhaseId = groupExternalResultsByPhase(results);

  assert.deepEqual(Object.keys(byPhaseId), ['20', '21']);
  assert.deepEqual(byPhaseId[20].map((result) => result.key), ['result:3', 'result:1']);
  assert.deepEqual(byPhaseId[21].map((result) => result.key), ['result:2']);
});

test('results with the same time are ordered by arrival, and those without a time go last', () => {
  const sameTime = '2026-11-05T10:00:00.000Z';
  const results = mergeExternalResults([], [
    liveExternalResult(liveEvent({ resultId: null, receivedAt: undefined }), () => 'no-time'),
    liveExternalResult(liveEvent({ resultId: 'a', receivedAt: sameTime })),
    liveExternalResult(liveEvent({ resultId: 'b', receivedAt: sameTime }))
  ]);

  assert.deepEqual(
    groupExternalResultsByPhase(results)[20].map((result) => result.key),
    ['result:b', 'result:a', 'local:no-time']
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createExternalResultsLoader,
  createLoadSequencer,
  createReconnectTracker,
  isPhaseTransition
} from '../externalResultsLoading.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// Lets the loader's promise chains settle.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// A loader whose fetches the test answers one by one.
function harness() {
  const requests = [];
  const applied = [];
  const failures = [];
  const loader = createExternalResultsLoader({
    fetchResults: (target) => {
      const request = deferred();
      requests.push({ target, ...request });
      return request.promise;
    },
    applyResults: (results) => applied.push(results),
    reportFailure: (error, target) => failures.push({ error, target })
  });

  return { loader, requests, applied, failures };
}

const target = { sessionId: 3, userId: 7 };

test('a phase transition is a change between two phases of the same session', () => {
  const phase20 = { sessionId: 3, phaseId: 20 };

  assert.equal(isPhaseTransition(phase20, { sessionId: 3, phaseId: 21 }), true);
  assert.equal(isPhaseTransition(null, phase20), false);
  assert.equal(isPhaseTransition(phase20, { sessionId: 3, phaseId: 20 }), false);
  assert.equal(isPhaseTransition(phase20, { sessionId: 4, phaseId: 21 }), false);
  assert.equal(isPhaseTransition(phase20, { sessionId: 3, phaseId: null }), false);
});

test('the first connect is not a reconnect; every later one is', () => {
  const tracker = createReconnectTracker();

  assert.equal(tracker.handleConnect(), false);
  assert.equal(tracker.handleConnect(), true);
  assert.equal(tracker.handleConnect(), true);
});

test('for a socket already connected, the next connect is a reconnect', () => {
  assert.equal(createReconnectTracker({ connected: true }).handleConnect(), true);
});

test('the sequencer applies an answer only when no later one was applied', () => {
  const sequencer = createLoadSequencer();
  const first = sequencer.begin();
  const second = sequencer.begin();

  assert.equal(sequencer.accept(second), true);
  assert.equal(sequencer.accept(first), false);

  const third = sequencer.begin();
  sequencer.reset();
  assert.equal(sequencer.accept(third), false);
  assert.equal(sequencer.accept(sequencer.begin()), true);
});

test('opening the activity loads its results', async () => {
  const { loader, requests, applied } = harness();

  loader.open(target);
  await flush();

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].target, target);

  requests[0].resolve([{ resultId: '1' }]);
  await flush();
  assert.deepEqual(applied, [[{ resultId: '1' }]]);
});

test('nothing loads while the activity cannot be loaded', async () => {
  const { loader, requests } = harness();

  loader.open(null);
  loader.open({ sessionId: 3, userId: null });
  loader.phaseChanged({ sessionId: 3, phaseId: 20 });
  loader.phaseChanged({ sessionId: 3, phaseId: 21 });
  loader.reconnected();
  await flush();

  assert.equal(requests.length, 0);
});

test('a phase transition loads; the first phase seen and the same phase again do not', async () => {
  const { loader, requests } = harness();

  loader.open(target);
  loader.phaseChanged({ sessionId: 3, phaseId: 20 });
  loader.phaseChanged({ sessionId: 3, phaseId: 20 });
  await flush();
  assert.equal(requests.length, 1);

  loader.phaseChanged({ sessionId: 3, phaseId: 21 });
  await flush();
  assert.equal(requests.length, 2);
});

test('a phase seen before the activity could load counts for the next transition', async () => {
  const { loader, requests } = harness();

  loader.phaseChanged({ sessionId: 3, phaseId: 20 });
  loader.open(target);
  await flush();
  assert.equal(requests.length, 1);

  loader.phaseChanged({ sessionId: 3, phaseId: 21 });
  await flush();
  assert.equal(requests.length, 2);
});

test('a phase of another activity does not load', async () => {
  const { loader, requests } = harness();

  loader.open(target);
  loader.phaseChanged({ sessionId: 4, phaseId: 20 });
  loader.phaseChanged({ sessionId: 4, phaseId: 21 });
  await flush();

  assert.equal(requests.length, 1);
});

test('a reconnect loads', async () => {
  const { loader, requests } = harness();

  loader.open(target);
  loader.reconnected();
  await flush();

  assert.equal(requests.length, 2);
});

test('joining the student\'s room loads, for the results the opening load missed', async () => {
  const { loader, requests, applied } = harness();

  loader.open(target);
  await flush();
  requests[0].resolve([]);
  await flush();
  loader.subscribed();
  await flush();
  requests[1].resolve([{ resultId: 'missed-result', phaseId: 21 }]);
  await flush();

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].target, target);
  assert.deepEqual(applied, [[], [{ resultId: 'missed-result', phaseId: 21 }]]);
});

test('joining the room before the activity can load loads nothing', async () => {
  const { loader, requests } = harness();

  loader.open(null);
  loader.subscribed();
  await flush();

  assert.equal(requests.length, 0);
});

test('a slow older answer does not replace a newer one', async () => {
  const { loader, requests, applied } = harness();

  loader.open(target);
  loader.reconnected();
  await flush();

  requests[1].resolve([{ resultId: 'newer' }]);
  await flush();
  requests[0].resolve([{ resultId: 'older' }]);
  await flush();

  assert.deepEqual(applied, [[{ resultId: 'newer' }]]);
});

test('answers in order are all applied', async () => {
  const { loader, requests, applied } = harness();

  loader.open(target);
  loader.reconnected();
  await flush();

  requests[0].resolve([{ resultId: '1' }]);
  await flush();
  requests[1].resolve([{ resultId: '1' }, { resultId: '2' }]);
  await flush();

  assert.equal(applied.length, 2);
});

test('a failed load is reported and applies nothing', async () => {
  const { loader, requests, applied, failures } = harness();
  const error = Object.assign(new Error('boom'), { response: { status: 500 } });

  loader.open(target);
  await flush();
  requests[0].reject(error);
  await flush();

  assert.deepEqual(applied, []);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].error, error);
  assert.deepEqual(failures[0].target, target);
});

test('a fetch that throws at once is reported too', async () => {
  const failures = [];
  const loader = createExternalResultsLoader({
    fetchResults: () => {
      throw new TypeError('bad ids');
    },
    applyResults: () => assert.fail('nothing to apply'),
    reportFailure: (error) => failures.push(error)
  });

  loader.open(target);
  await flush();

  assert.equal(failures.length, 1);
});

test('answers for another activity, or after it closed, are discarded', async () => {
  const { loader, requests, applied } = harness();

  loader.open(target);
  loader.open({ sessionId: 4, userId: 7 });
  await flush();
  requests[0].resolve([{ resultId: 'session-3' }]);
  requests[1].resolve([{ resultId: 'session-4' }]);
  await flush();

  assert.deepEqual(applied, [[{ resultId: 'session-4' }]]);

  loader.reconnected();
  loader.open(null);
  await flush();
  requests[2].resolve([{ resultId: 'late' }]);
  await flush();

  assert.equal(applied.length, 1);
});

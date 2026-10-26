import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosError, AxiosHeaders } from 'axios';
import { createRealtimeConnectionMonitor } from '../realtimeConnectionMonitor.js';

function httpError(status, data, headers = {}) {
  const response = { status, data, headers: new AxiosHeaders(headers), config: {} };
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', {}, {}, response);
}

function createMonitor(checkSession) {
  const events = [];
  let checks = 0;
  const monitor = createRealtimeConnectionMonitor({
    checkSession: async () => {
      checks += 1;
      return checkSession();
    },
    onIssue: (issue) => events.push(['issue', issue]),
    onRecovered: () => events.push(['recovered'])
  });
  return { monitor, events, checks: () => checks };
}

test('a failure with a valid session is reported once until the socket connects again', async () => {
  const { monitor, events, checks } = createMonitor(() => ({ status: 200 }));

  await monitor.handleConnectError();
  await monitor.handleConnectError();
  monitor.handleConnect();

  assert.equal(checks(), 1);
  assert.deepEqual(events, [['issue', { kind: 'unavailable', requestId: null }], ['recovered']]);
});

test('an expired session reports nothing, because the API interceptor handles it', async () => {
  const { monitor, events } = createMonitor(() => {
    throw httpError(401, { status: 'expired' });
  });

  await monitor.handleConnectError();

  assert.deepEqual(events, []);
});

test('an outage found by the session check carries its request id', async () => {
  const { monitor, events } = createMonitor(() => {
    throw httpError(502, { status: 'unavailable' }, { 'x-request-id': 'req-9' });
  });

  await monitor.handleConnectError();

  assert.deepEqual(events, [['issue', { kind: 'unavailable', requestId: 'req-9' }]]);
});

test('concurrent failures share one session check', async () => {
  let release;
  const { monitor, events, checks } = createMonitor(() => new Promise((resolve) => {
    release = resolve;
  }));

  const first = monitor.handleConnectError();
  const second = monitor.handleConnectError();
  release({ status: 200 });
  await Promise.all([first, second]);

  assert.equal(checks(), 1);
  assert.equal(events.length, 1);
});

test('a reconnection during the session check discards the stale issue', async () => {
  let release;
  const { monitor, events } = createMonitor(() => new Promise((resolve) => {
    release = resolve;
  }));

  const pending = monitor.handleConnectError();
  monitor.handleConnect();
  release({ status: 200 });
  await pending;

  assert.deepEqual(events, []);
});

test('a later disconnection is checked again after recovery', async () => {
  const { monitor, events, checks } = createMonitor(() => ({ status: 200 }));

  await monitor.handleConnectError();
  monitor.handleConnect();
  await monitor.handleConnectError();

  assert.equal(checks(), 2);
  assert.deepEqual(events.map(([name]) => name), ['issue', 'recovered', 'issue']);
});

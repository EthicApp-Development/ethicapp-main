import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionExpiryFlow, SESSION_EXPIRY_REDIRECT_DELAY_MS } from '../sessionExpiry.js';

function createFlow() {
  const scheduled = [];
  const flow = createSessionExpiryFlow({
    redirect: () => {},
    schedule: (callback, delayMs) => scheduled.push({ callback, delayMs })
  });
  return { flow, scheduled };
}

test('the flow starts once: one notice and one scheduled redirect', () => {
  const { flow, scheduled } = createFlow();
  let notifications = 0;
  flow.subscribe(() => {
    notifications += 1;
  });

  assert.equal(flow.getSnapshot(), null);
  assert.equal(flow.start({ requestId: 'req-1' }), true);
  assert.equal(flow.start({ requestId: 'req-2' }), false);

  assert.deepEqual(flow.getSnapshot(), { requestId: 'req-1' });
  assert.equal(notifications, 1);
  assert.deepEqual(scheduled.map(({ delayMs }) => delayMs), [SESSION_EXPIRY_REDIRECT_DELAY_MS]);
});

test('unsubscribed listeners are not notified', () => {
  const { flow } = createFlow();
  let notifications = 0;
  const unsubscribe = flow.subscribe(() => {
    notifications += 1;
  });

  unsubscribe();
  flow.start();

  assert.equal(notifications, 0);
  assert.deepEqual(flow.getSnapshot(), { requestId: null });
});

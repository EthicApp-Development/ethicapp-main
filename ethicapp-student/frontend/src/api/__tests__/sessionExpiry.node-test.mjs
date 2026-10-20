import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSessionExpiryFlow,
  SESSION_EXPIRY_REDIRECT_DELAY_MS
} from '../sessionExpiry.js';

function createFlow() {
  const scheduled = [];
  const redirects = [];
  const flow = createSessionExpiryFlow({
    redirect: (signInUrl) => redirects.push(signInUrl),
    schedule: (callback, delayMs) => scheduled.push({ callback, delayMs })
  });
  return { flow, scheduled, redirects };
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
  assert.equal(flow.getSnapshot().requestId, null);
});

for (const previousTarget of ['/student/?join=abc123', '/student/sessions/57', null]) {
  test(`expiry returns to manual selection instead of ${previousTarget}`, () => {
    const { flow, scheduled, redirects } = createFlow();
    flow.start({ requestId: 'req-1', returnTo: previousTarget });
    scheduled[0].callback();

    assert.deepEqual(flow.getSnapshot(), {
      requestId: 'req-1'
    });
    assert.deepEqual(redirects, ['/auth/login']);
  });
}

test('later failures cannot replace manual selection with a session or join code', () => {
  const { flow, scheduled, redirects } = createFlow();
  let notifications = 0;
  flow.subscribe(() => notifications += 1);
  flow.start({ requestId: 'req-profile' });
  flow.start({ returnTo: '/student/?join=abc123' });
  flow.start({ returnTo: '/student/sessions/57' });
  scheduled[0].callback();

  assert.deepEqual(flow.getSnapshot(), { requestId: 'req-profile' });
  assert.equal(notifications, 1);
  assert.equal(scheduled.length, 1);
  assert.deepEqual(redirects, ['/auth/login']);
});

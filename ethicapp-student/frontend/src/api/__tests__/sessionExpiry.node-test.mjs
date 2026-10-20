import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSignInUrl,
  createSessionExpiryFlow,
  currentStudentLocation,
  SESSION_EXPIRY_REDIRECT_DELAY_MS
} from '../sessionExpiry.js';

function createFlow({ currentLocation } = {}) {
  const scheduled = [];
  const redirects = [];
  const flow = createSessionExpiryFlow({
    redirect: (signInUrl) => redirects.push(signInUrl),
    currentLocation,
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

  assert.deepEqual(flow.getSnapshot(), { requestId: 'req-1', returnTo: null, signInUrl: '/auth/login' });
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

test('the sign-in redirect carries the return target of the failed call', () => {
  const { flow, scheduled, redirects } = createFlow({ currentLocation: () => '/student/sessions/57' });

  flow.start({ returnTo: '/student/?join=abc123' });
  scheduled[0].callback();

  assert.equal(flow.getSnapshot().signInUrl, '/auth/login?returnTo=%2Fstudent%2F%3Fjoin%3Dabc123');
  assert.deepEqual(redirects, ['/auth/login?returnTo=%2Fstudent%2F%3Fjoin%3Dabc123']);
});

test('without a target from the call, the student returns to the current location', () => {
  const { flow } = createFlow({ currentLocation: () => '/student/sessions/57' });

  flow.start({ requestId: 'req-1' });

  assert.equal(flow.getSnapshot().returnTo, '/student/sessions/57');
  assert.equal(flow.getSnapshot().signInUrl, '/auth/login?returnTo=%2Fstudent%2Fsessions%2F57');
});

test('currentStudentLocation only returns locations inside the student app', () => {
  assert.equal(currentStudentLocation({ pathname: '/student/sessions/57', search: '?tab=2' }), '/student/sessions/57?tab=2');
  assert.equal(currentStudentLocation({ pathname: '/home', search: '' }), null);
  assert.equal(currentStudentLocation(undefined), null);
  assert.equal(buildSignInUrl(null), '/auth/login');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import hydrateLegacySession from '../hydrateLegacySession.js';

function runMiddleware({ headers = {}, session = {} }) {
  return new Promise((resolve, reject) => {
    const req = {
      session,
      get(name) {
        return headers[name] || headers[name.toLowerCase()];
      }
    };

    hydrateLegacySession(req, {}, (err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(req.session);
    });
  });
}

test('hydrates an empty legacy session from auth proxy headers', async () => {
  const session = await runMiddleware({
    headers: {
      'X-User-Id': '42',
      'X-User-Role': 'P'
    }
  });

  assert.equal(session.uid, 42);
  assert.equal(session.role, 'P');
  assert.equal(session.authUid, 42);
  assert.equal(session.authRole, 'P');
  assert.equal(session.impersonating, false);
});

test('updates stale local role when canonical auth identity is unchanged', async () => {
  const session = await runMiddleware({
    headers: {
      'X-User-Id': '42',
      'X-User-Role': 'P'
    },
    session: {
      uid: 42,
      role: 'A',
      authUid: 42,
      authRole: 'A',
      impersonating: false
    }
  });

  assert.equal(session.uid, 42);
  assert.equal(session.role, 'P');
  assert.equal(session.authUid, 42);
  assert.equal(session.authRole, 'P');
});

test('keeps effective legacy role while impersonating', async () => {
  const session = await runMiddleware({
    headers: {
      'X-User-Id': '7',
      'X-User-Role': 'S'
    },
    session: {
      uid: 42,
      role: 'P',
      authUid: 7,
      authRole: 'S',
      impersonating: true
    }
  });

  assert.equal(session.uid, 42);
  assert.equal(session.role, 'P');
  assert.equal(session.authUid, 7);
  assert.equal(session.authRole, 'S');
});

function impersonatingSession() {
  const session = {
    uid: 42,
    role: 'P',
    authUid: 7,
    authRole: 'S',
    impersonating: true,
    regenerated: false,
    regenerate(callback) {
      for (const key of Object.keys(session)) {
        if (typeof session[key] !== 'function') {
          delete session[key];
        }
      }
      session.regenerated = true;
      callback();
    }
  };
  return session;
}

test('drops impersonation when another user signs in on the same browser', async () => {
  const session = await runMiddleware({
    headers: {
      'X-User-Id': '99',
      'X-User-Role': 'A'
    },
    session: impersonatingSession()
  });

  assert.equal(session.regenerated, true);
  assert.equal(session.uid, 99);
  assert.equal(session.role, 'A');
  assert.equal(session.authUid, 99);
  assert.equal(session.authRole, 'A');
  assert.equal(session.impersonating, false);
});

test('drops impersonation when the impersonated teacher signs in', async () => {
  const session = await runMiddleware({
    headers: {
      'X-User-Id': '42',
      'X-User-Role': 'P'
    },
    session: impersonatingSession()
  });

  assert.equal(session.regenerated, true);
  assert.equal(session.uid, 42);
  assert.equal(session.role, 'P');
  assert.equal(session.authUid, 42);
  assert.equal(session.impersonating, false);
});

test('drops impersonation when the super-admin no longer has role S', async () => {
  const session = await runMiddleware({
    headers: {
      'X-User-Id': '7',
      'X-User-Role': 'P'
    },
    session: impersonatingSession()
  });

  assert.equal(session.regenerated, true);
  assert.equal(session.uid, 7);
  assert.equal(session.role, 'P');
  assert.equal(session.impersonating, false);
});

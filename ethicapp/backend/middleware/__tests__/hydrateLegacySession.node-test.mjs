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

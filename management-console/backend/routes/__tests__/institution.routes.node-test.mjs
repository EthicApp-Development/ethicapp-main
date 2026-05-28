import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { createInstitutionRouter } from '../institution.routes.js';

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const { port } = server.address();

  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function createTestApp(router) {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    req.session = {
      uid: 7,
      role: 'S'
    };
    next();
  });
  app.use(router);
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    return res.status(500).json({ error: err.message });
  });

  return app;
}

describe('management-console institution routes', () => {
  it('returns institution settings', async () => {
    const router = createInstitutionRouter({
      getInstitutionSettingsService: async () => ({
        id: 1,
        name: 'Universidad Demo',
        logo: null,
        contacts: []
      })
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/institution`);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        id: 1,
        name: 'Universidad Demo',
        logo: null,
        contacts: []
      });
    });
  });

  it('updates institution settings and forwards contact payloads', async () => {
    const calls = [];
    const router = createInstitutionRouter({
      updateInstitutionSettingsService: async (payload) => {
        calls.push(payload);
        return {
          id: 1,
          name: payload.name,
          logo: null,
          contacts: []
        };
      }
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/institution`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Universidad Demo',
          contacts: {
            technical: {
              firstname: 'Tech',
              lastname: 'Contact',
              email: 'tech@example.com',
              phoneCountryCode: '+56',
              phoneNumber: '912345678'
            },
            academic: {
              firstname: 'Academic',
              lastname: 'Contact',
              email: 'academic@example.com',
              phoneCountryCode: '+56',
              phoneNumber: '987654321'
            }
          }
        })
      });

      assert.equal(response.status, 200);
      assert.equal((await response.json()).name, 'Universidad Demo');
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].contacts.technical.email, 'tech@example.com');
    assert.equal(calls[0].contacts.academic.phoneNumber, '987654321');
  });

  it('maps logo validation failures to bad requests', async () => {
    const router = createInstitutionRouter({
      updateInstitutionSettingsService: async () => {
        throw new Error('INVALID_LOGO_TYPE');
      }
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/institution`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Universidad Demo',
          logo: {
            filename: 'logo.gif',
            mimeType: 'image/gif',
            data: 'abc'
          }
        })
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: 'INVALID_LOGO_TYPE'
      });
    });
  });

  it('serves the configured institution logo', async () => {
    const router = createInstitutionRouter({
      getInstitutionLogoService: async () => ({
        filename: 'logo.png',
        mimeType: 'image/png',
        bytes: Buffer.from('png-bytes'),
        updatedAt: new Date('2026-01-01T00:00:00Z')
      })
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/institution/logo`);

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(await response.text(), 'png-bytes');
    });
  });
});

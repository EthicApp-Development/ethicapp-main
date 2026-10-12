import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { csrfProtection } from '../../middleware/csrfProtection.js';
import { createHealthRouter } from '../health.routes.js';

const CSRF_TOKEN = 'test-csrf-token';

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

function createTestApp(router, { role = 'S' } = {}) {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    req.session = {
      uid: 7,
      role,
      csrfToken: CSRF_TOKEN
    };
    next();
  });
  app.use('/mng/api', csrfProtection);
  app.use(router);
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    return res.status(500).json({ error: err.message });
  });

  return app;
}

function postDns(baseUrl, { body = {}, csrfToken = CSRF_TOKEN } = {}) {
  return fetch(`${baseUrl}/mng/api/health/dns`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
    },
    body: JSON.stringify(body)
  });
}

function createFakeDnsService() {
  const calls = [];
  return {
    calls,
    async checkTargets(targets) {
      calls.push(targets);
      return {
        checkedAt: '2026-10-12T12:00:00.000Z',
        servers: ['127.0.0.11'],
        upstreamServers: ['100.100.100.100'],
        targets: targets.map(({ label, host, port }) => ({
          label,
          host,
          port,
          lookup: { ok: true, addresses: ['192.0.2.1'], latencyMs: 2, error: null },
          resolve: { ok: false, addresses: [], latencyMs: 3, error: 'ESERVFAIL' }
        }))
      };
    }
  };
}

const configuredTargets = Object.freeze([
  Object.freeze({ label: 'smtp', host: 'smtp.gmail.com', port: 465 })
]);

describe('management-console health routes', () => {
  it('runs the DNS check against the configured targets', async () => {
    const dnsHealthService = createFakeDnsService();
    const router = createHealthRouter({
      getHealthCheckTargetsService: () => configuredTargets,
      dnsHealthService
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postDns(baseUrl);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        checkedAt: '2026-10-12T12:00:00.000Z',
        servers: ['127.0.0.11'],
        upstreamServers: ['100.100.100.100'],
        targets: [{
          label: 'smtp',
          host: 'smtp.gmail.com',
          port: 465,
          lookup: { ok: true, addresses: ['192.0.2.1'], latencyMs: 2, error: null },
          resolve: { ok: false, addresses: [], latencyMs: 3, error: 'ESERVFAIL' }
        }]
      });
    });
  });

  it('ignores hosts supplied in the request body', async () => {
    const dnsHealthService = createFakeDnsService();
    const router = createHealthRouter({
      getHealthCheckTargetsService: () => configuredTargets,
      dnsHealthService
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postDns(baseUrl, {
        body: { targets: [{ label: 'internal', host: 'postgresql', port: 5432 }], host: 'postgresql' }
      });

      assert.equal(response.status, 200);
      assert.deepEqual(dnsHealthService.calls, [configuredTargets]);
    });
  });

  it('serves the cached result during the cooldown', async () => {
    const dnsHealthService = createFakeDnsService();
    let currentTime = 0;
    const router = createHealthRouter({
      getHealthCheckTargetsService: () => configuredTargets,
      dnsHealthService,
      cooldownMs: 5000,
      now: () => currentTime
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      await postDns(baseUrl);
      currentTime = 4000;
      await postDns(baseUrl);
      assert.equal(dnsHealthService.calls.length, 1);

      currentTime = 5000;
      await postDns(baseUrl);
      assert.equal(dnsHealthService.calls.length, 2);
    });
  });

  it('rejects users without the management role', async () => {
    const dnsHealthService = createFakeDnsService();
    const router = createHealthRouter({
      getHealthCheckTargetsService: () => configuredTargets,
      dnsHealthService
    });

    await withServer(createTestApp(router, { role: 'P' }), async (baseUrl) => {
      const response = await postDns(baseUrl);

      assert.equal(response.status, 403);
      assert.deepEqual(dnsHealthService.calls, []);
    });
  });

  it('rejects requests without a valid CSRF token', async () => {
    const dnsHealthService = createFakeDnsService();
    const router = createHealthRouter({
      getHealthCheckTargetsService: () => configuredTargets,
      dnsHealthService
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const missing = await postDns(baseUrl, { csrfToken: null });
      const wrong = await postDns(baseUrl, { csrfToken: 'wrong-token' });

      assert.equal(missing.status, 403);
      assert.equal(wrong.status, 403);
      assert.deepEqual(dnsHealthService.calls, []);
    });
  });

  it('passes unexpected service failures to the error handler', async () => {
    const router = createHealthRouter({
      getHealthCheckTargetsService: () => configuredTargets,
      dnsHealthService: {
        async checkTargets() {
          throw new Error('unexpected failure');
        }
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postDns(baseUrl);

      assert.equal(response.status, 500);
    });
  });
});

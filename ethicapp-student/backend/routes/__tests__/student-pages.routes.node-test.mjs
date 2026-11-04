import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createStudentPagesRouter } from '../student-pages.routes.js';

function createFrontendDist() {
  const frontendDist = fs.mkdtempSync(path.join(os.tmpdir(), 'student-dist-'));
  fs.mkdirSync(path.join(frontendDist, 'assets'));
  fs.writeFileSync(path.join(frontendDist, 'index.html'), '<!doctype html><title>student</title>');
  fs.writeFileSync(path.join(frontendDist, 'assets', 'app.js'), 'console.log("app");');
  fs.writeFileSync(path.join(frontendDist, 'runtime-config.js'), 'window.__STUDENT_RUNTIME_CONFIG__ = {};');
  return frontendDist;
}

async function withApp(session, run) {
  const frontendDist = createFrontendDist();
  const app = express();
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use('/student', createStudentPagesRouter({ frontendDist }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    await run((pagePath) => fetch(`http://127.0.0.1:${port}${pagePath}`, { redirect: 'manual' }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(frontendDist, { recursive: true, force: true });
  }
}

const GATED_PATHS = ['/student/', '/student/index.html', '/student/assets/app.js', '/student/sessions/12'];

test('a student session gets the SPA, its assets and its client routes', async () => {
  await withApp({ uid: 44, role: 'A' }, async (get) => {
    for (const pagePath of GATED_PATHS) {
      assert.equal((await get(pagePath)).status, 200, pagePath);
    }

    assert.match(await (await get('/student/sessions/12')).text(), /<title>student<\/title>/);
  });
});

test('professor and administrator sessions are redirected home from every page and asset', async () => {
  for (const [role, home] of [['P', '/home'], ['S', '/mng']]) {
    await withApp({ uid: 7, role }, async (get) => {
      for (const pagePath of GATED_PATHS) {
        const response = await get(pagePath);

        assert.equal(response.status, 302, `${role} ${pagePath}`);
        assert.equal(response.headers.get('location'), home, `${role} ${pagePath}`);
      }
    });
  }
});

test('a session whose role has no home gets 403', async () => {
  for (const role of ['X', null]) {
    await withApp({ uid: 7, role }, async (get) => {
      const response = await get('/student/');

      assert.equal(response.status, 403, String(role));
      assert.deepEqual(await response.json(), { error: 'User does not have student permissions' });
    });
  }
});

test('an unauthenticated page request is redirected to the login page', async () => {
  await withApp({}, async (get) => {
    const response = await get('/student/sessions/12');

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/auth/login');
  });
});

test('runtime-config.js stays public', async () => {
  for (const session of [{}, { uid: 7, role: 'P' }, { uid: 44, role: 'A' }]) {
    await withApp(session, async (get) => {
      const response = await get('/student/runtime-config.js');

      assert.equal(response.status, 200);
      assert.match(await response.text(), /__STUDENT_RUNTIME_CONFIG__/);
    });
  }
});

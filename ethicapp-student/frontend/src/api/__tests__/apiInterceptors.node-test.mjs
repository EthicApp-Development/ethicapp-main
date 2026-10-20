import assert from 'node:assert/strict';
import test from 'node:test';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import { API_ERROR_KINDS, classifyApiError } from '../apiErrors.js';
import { installApiErrorInterceptors, isAuthEndpoint, resolveRequestPath } from '../apiInterceptors.js';
import { createSessionExpiryFlow } from '../sessionExpiry.js';

const JSON_TYPE = { 'content-type': 'application/json; charset=utf-8' };

// Axios adapter that answers like the NGINX edge and the backends would.
function fakeAdapter(answer) {
  return async (config) => {
    const reply = answer(config);

    if (reply.networkError) {
      throw new AxiosError('Network Error', 'ERR_NETWORK', config, {});
    }

    const response = {
      data: reply.data,
      status: reply.status,
      statusText: '',
      headers: new AxiosHeaders(reply.headers ?? JSON_TYPE),
      config,
      request: {}
    };

    if (reply.status >= 200 && reply.status < 300) {
      return response;
    }

    throw new AxiosError(`Request failed with status code ${reply.status}`, 'ERR_BAD_RESPONSE', config, {}, response);
  };
}

function createClient(answer, axiosOptions = {}) {
  const redirects = [];
  const expiryFlow = createSessionExpiryFlow({
    redirect: (signInUrl) => redirects.push(signInUrl),
    schedule: (callback) => callback()
  });
  const expiredCalls = [];
  const client = installApiErrorInterceptors(axios.create({ adapter: fakeAdapter(answer), ...axiosOptions }), {
    onExpired: (details) => {
      expiredCalls.push(details);
      expiryFlow.start(details);
    }
  });

  return { client, expiryFlow, expiredCalls, redirects };
}

const EXPIRED = { status: 401, data: { status: 'expired' }, headers: { ...JSON_TYPE, 'x-request-id': 'req-401' } };

test('a 401 on a protected call starts the expiry flow once, however many calls fail', async () => {
  const { client, expiryFlow, expiredCalls, redirects } = createClient(() => EXPIRED);

  const results = await Promise.allSettled([client.get('/users/profile'), client.post('/activities/57/response', {})]);

  assert.deepEqual(results.map(({ status }) => status), ['rejected', 'rejected']);
  assert.equal(results[0].reason.response.status, 401, 'the caller still receives the original error');
  assert.equal(expiredCalls.length, 2);
  assert.equal(expiryFlow.getSnapshot().requestId, 'req-401');
  assert.equal(redirects.length, 1);
});

test('the expiry flow receives the return target named by the failed request', async () => {
  const { client, expiredCalls, redirects } = createClient(() => EXPIRED, { baseURL: '/student/api/' });

  await assert.rejects(client.post('sessions/join', { code: 'abc123' }, { expiryReturnTo: '/student/?join=abc123' }));

  assert.deepEqual(expiredCalls, [{ requestId: 'req-401', returnTo: '/student/?join=abc123' }]);
  assert.deepEqual(redirects, ['/auth/login?returnTo=%2Fstudent%2F%3Fjoin%3Dabc123']);
});

for (const firstToFail of ['profile', 'join']) {
  test(`the join target survives a concurrent background 401 when the ${firstToFail} fails first`, async () => {
    const releases = {};
    const scheduled = [];
    const redirects = [];
    const expiryFlow = createSessionExpiryFlow({
      redirect: (signInUrl) => redirects.push(signInUrl),
      currentLocation: () => '/student/',
      schedule: (callback, delayMs) => scheduled.push({ callback, delayMs })
    });
    const adapter = fakeAdapter(() => EXPIRED);
    const client = installApiErrorInterceptors(axios.create({
      // Each request waits until the test releases it, to control the order.
      adapter: (config) => new Promise((resolve) => {
        releases[config.url.includes('profile') ? 'profile' : 'join'] = resolve;
      }).then(() => adapter(config))
    }), { onExpired: (details) => expiryFlow.start(details) });

    const profile = client.get('/users/profile');
    const join = client.post('/student/api/sessions/join', { code: 'abc123' }, {
      expiryReturnTo: '/student/?join=abc123'
    });
    await new Promise((resolve) => setImmediate(resolve));

    const order = firstToFail === 'profile' ? ['profile', 'join'] : ['join', 'profile'];
    for (const name of order) {
      releases[name]();
      await (name === 'profile' ? profile : join).catch(() => {});
    }
    scheduled.forEach(({ callback }) => callback());

    assert.equal(expiryFlow.getSnapshot().returnTo, '/student/?join=abc123');
    assert.equal(scheduled.length, 1);
    assert.deepEqual(redirects, ['/auth/login?returnTo=%2Fstudent%2F%3Fjoin%3Dabc123']);
  });
}

test('a 401 from an auth endpoint does not start the expiry flow', async () => {
  const { client, expiredCalls, redirects } = createClient(() => EXPIRED);

  await assert.rejects(client.post('/api/auth/login', {}));
  await assert.rejects(client.get('/auth/session/check'));

  assert.deepEqual(expiredCalls, []);
  assert.deepEqual(redirects, []);
});

test('an HTML page delivered to an API call becomes an expired-session failure', async () => {
  const { client, expiredCalls } = createClient(() => ({
    status: 200,
    data: '<!doctype html><title>Sign in</title>',
    headers: { 'content-type': 'text/html; charset=utf-8' }
  }), { baseURL: '/student/api/' });

  const error = await client.post('sessions/join', { code: 'abc123' }).then(
    () => assert.fail('expected the call to fail'),
    (rejection) => rejection
  );

  assert.equal(error.code, 'ERR_HTML_RESPONSE');
  assert.equal(classifyApiError(error).kind, API_ERROR_KINDS.EXPIRED);
  assert.equal(expiredCalls.length, 1);
});

test('400, 403, 404 and 409 reach the caller unchanged without starting the flow', async () => {
  for (const status of [400, 403, 404, 409]) {
    const body = { status: 'code_not_found', error: `refused with ${status}` };
    const { client, expiredCalls } = createClient(() => ({ status, data: body }), { baseURL: '/student/api/' });

    const error = await client.post('sessions/join', { code: 'abc123' }).then(
      () => assert.fail('expected the call to fail'),
      (rejection) => rejection
    );

    assert.equal(error.response.status, status);
    assert.deepEqual(error.response.data, body);
    assert.deepEqual(expiredCalls, [], `status ${status}`);
  }
});

test('outages and network failures reach the caller classified, without the flow', async () => {
  const outage = createClient(() => ({
    status: 502,
    data: { status: 'unavailable' },
    headers: { ...JSON_TYPE, 'x-request-id': 'req-502' }
  }));
  const outageError = await outage.client.get('/users/profile').catch((error) => error);
  assert.deepEqual(
    [classifyApiError(outageError).kind, classifyApiError(outageError).requestId],
    [API_ERROR_KINDS.UNAVAILABLE, 'req-502']
  );
  assert.deepEqual(outage.expiredCalls, []);

  const network = createClient(() => ({ networkError: true }));
  const networkError = await network.client.get('/users/profile').catch((error) => error);
  assert.equal(classifyApiError(networkError).kind, API_ERROR_KINDS.NETWORK);
  assert.deepEqual(network.expiredCalls, []);
});

test('successful JSON responses pass through untouched', async () => {
  const { client, expiredCalls } = createClient(() => ({ status: 200, data: { uid: 44 } }), { baseURL: '/student/api/' });

  const { data } = await client.get('session');

  assert.deepEqual(data, { uid: 44 });
  assert.deepEqual(expiredCalls, []);
});

test('request paths resolve against the instance base URL', () => {
  assert.equal(resolveRequestPath({ baseURL: '/student/api/', url: 'sessions/join' }), '/student/api/sessions/join');
  assert.equal(resolveRequestPath({ url: '/users/profile' }), '/users/profile');
  assert.equal(isAuthEndpoint({ url: '/api/auth/login' }), true);
  assert.equal(isAuthEndpoint({ url: '/auth/login' }), true);
  assert.equal(isAuthEndpoint({ baseURL: '/student/api/', url: 'session' }), false);
  assert.equal(isAuthEndpoint({ url: '/authors' }), false);
});

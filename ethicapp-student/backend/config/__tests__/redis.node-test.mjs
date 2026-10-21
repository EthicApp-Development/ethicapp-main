import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApplicationRedisUrl } from '../redis.js';

test('builds the URL from REDIS_APP_HOST and REDIS_APP_PORT', () => {
  assert.equal(resolveApplicationRedisUrl({ REDIS_APP_HOST: 'redis-app.internal', REDIS_APP_PORT: '6380' }), 'redis://redis-app.internal:6380');
});

test('prefers REDIS_APP_URL', () => {
  assert.equal(resolveApplicationRedisUrl({ REDIS_APP_URL: 'rediss://app:6379', REDIS_APP_HOST: 'ignored' }), 'rediss://app:6379');
});

test('defaults to the redis-app service', () => {
  assert.equal(resolveApplicationRedisUrl({}), 'redis://redis-app:6379');
});

test('does not read the former REDIS_SESSION_* names', () => {
  assert.equal(resolveApplicationRedisUrl({ REDIS_SESSION_HOST: 'redis-session', REDIS_SESSION_URL: 'redis://legacy:6379' }), 'redis://redis-app:6379');
});

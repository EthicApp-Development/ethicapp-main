import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApplicationRedis, resolveApplicationRedisUrl } from './application-redis.js';

function createLogger() {
  const warnings = [];
  return { warnings, warn: (message) => warnings.push(message) };
}

test('REDIS_APP_* decides when set, URL first', () => {
  assert.deepEqual(resolveApplicationRedis({ REDIS_APP_HOST: 'redis-app.internal', REDIS_APP_PORT: '6380' }), {
    url: 'redis://redis-app.internal:6380',
    deprecatedVariables: []
  });
  assert.equal(resolveApplicationRedis({ REDIS_APP_URL: 'rediss://app:6379', REDIS_APP_HOST: 'x' }).url, 'rediss://app:6379');
});

test('REDIS_SESSION_* is the deprecated fallback', () => {
  assert.deepEqual(resolveApplicationRedis({ REDIS_SESSION_HOST: 'redis-session' }), {
    url: 'redis://redis-session:6379',
    deprecatedVariables: ['REDIS_SESSION_HOST']
  });
});

test('both groups set: REDIS_APP_* wins and the groups are not mixed', () => {
  const resolved = resolveApplicationRedis({
    REDIS_APP_HOST: 'redis-app',
    REDIS_SESSION_URL: 'redis://legacy:6379'
  });

  assert.deepEqual(resolved, { url: 'redis://redis-app:6379', deprecatedVariables: [] });
});

test('nothing set defaults to the redis-app service', () => {
  assert.equal(resolveApplicationRedis({}).url, 'redis://redis-app:6379');
});

test('the deprecation warning is logged once per process', () => {
  const logger = createLogger();
  const processKey = {};

  resolveApplicationRedisUrl({ REDIS_SESSION_HOST: 'redis-session' }, logger, processKey);
  resolveApplicationRedisUrl({ REDIS_SESSION_HOST: 'redis-session' }, logger, processKey);
  resolveApplicationRedisUrl({ REDIS_APP_HOST: 'redis-app' }, logger, {});

  assert.equal(logger.warnings.length, 1);
  assert.match(logger.warnings[0], /REDIS_SESSION_HOST/);
});

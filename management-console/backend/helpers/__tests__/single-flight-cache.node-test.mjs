import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSingleFlightCache } from '../single-flight-cache.js';

function createClock(start = 1000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('single-flight cache', () => {
  it('shares one in-flight run between concurrent callers', async () => {
    const clock = createClock();
    const pending = deferred();
    let calls = 0;
    const run = createSingleFlightCache(() => {
      calls += 1;
      return pending.promise;
    }, { cooldownMs: 5000, now: clock.now });

    const first = run();
    const second = run();
    pending.resolve({ value: 1 });

    assert.deepEqual(await first, { value: 1 });
    assert.equal(await second, await first);
    assert.equal(calls, 1);
  });

  it('returns the cached result during the cooldown and reruns after it', async () => {
    const clock = createClock();
    let calls = 0;
    const run = createSingleFlightCache(async () => {
      calls += 1;
      return { run: calls };
    }, { cooldownMs: 5000, now: clock.now });

    assert.deepEqual(await run(), { run: 1 });

    clock.advance(4999);
    assert.deepEqual(await run(), { run: 1 });
    assert.equal(calls, 1);

    clock.advance(1);
    assert.deepEqual(await run(), { run: 2 });
    assert.equal(calls, 2);
  });

  it('does not cache failed runs', async () => {
    const clock = createClock();
    let calls = 0;
    const run = createSingleFlightCache(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('boom');
      }
      return { run: calls };
    }, { cooldownMs: 5000, now: clock.now });

    await assert.rejects(run(), /boom/);
    assert.deepEqual(await run(), { run: 2 });
  });
});

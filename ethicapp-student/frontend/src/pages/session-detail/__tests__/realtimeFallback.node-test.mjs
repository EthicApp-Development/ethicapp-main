import assert from 'node:assert/strict';
import test from 'node:test';
import { REALTIME_STATUS, createRealtimeFallback } from '../realtimeFallback.js';

// A manual clock with timers that fire when time advances.
function createClock() {
  let current = 0;
  let nextId = 1;
  const pending = new Map();

  return {
    now: () => current,
    timers: {
      setTimeout(callback, delay) {
        const id = nextId++;
        pending.set(id, { at: current + delay, callback });
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      }
    },
    pendingDelays: () => [...pending.values()].map(({ at }) => at - current).sort((a, b) => a - b),
    async advance(ms) {
      const target = current + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, a], [, b]) => a.at - b.at)[0];
        if (!due) break;
        const [id, timer] = due;
        pending.delete(id);
        current = timer.at;
        timer.callback();
        await flush();
      }
      current = target;
      await flush();
    }
  };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const OPTIONS = { noticeDelayMs: 8000, pollDelaysMs: [15000, 30000, 60000], jitter: 0, minProbeGapMs: 5000 };

function setup({ probeResult = false, refreshImpl = null, probeImpl = null } = {}) {
  const clock = createClock();
  const calls = { refresh: 0, probe: 0, statuses: [], errors: [] };
  const fallback = createRealtimeFallback({
    refresh: refreshImpl ?? (async () => {
      calls.refresh += 1;
    }),
    probe: probeImpl ?? (async () => {
      calls.probe += 1;
      return typeof probeResult === 'function' ? probeResult() : probeResult;
    }),
    onStatus: (status) => calls.statuses.push(status),
    onError: (error, operation) => calls.errors.push(operation),
    timers: clock.timers,
    now: clock.now,
    random: () => 0.5,
    options: OPTIONS
  });
  return { clock, calls, fallback };
}

test('the first connect only reports the status', async () => {
  const { calls, fallback } = setup();
  assert.equal(fallback.status(), REALTIME_STATUS.CONNECTING);

  fallback.connected();
  await flush();

  assert.equal(fallback.status(), REALTIME_STATUS.CONNECTED);
  assert.equal(calls.refresh, 0);
});

test('a short drop never shows the notice and refreshes on reconnect', async () => {
  const { clock, calls, fallback } = setup();
  fallback.connected();

  fallback.lost();
  assert.equal(fallback.status(), REALTIME_STATUS.RECONNECTING);
  await clock.advance(5000);
  fallback.connected();
  await flush();

  assert.deepEqual(calls.statuses, [REALTIME_STATUS.CONNECTED, REALTIME_STATUS.RECONNECTING, REALTIME_STATUS.CONNECTED]);
  assert.equal(calls.refresh, 1, 'a transition missed while down is recovered');
  assert.deepEqual(clock.pendingDelays(), [], 'no notice or poll timer is left');
});

test('a lasting drop shows the notice after the delay', async () => {
  const { clock, fallback } = setup();
  fallback.connected();
  fallback.lost();

  await clock.advance(7999);
  assert.equal(fallback.status(), REALTIME_STATUS.RECONNECTING);
  await clock.advance(1);
  assert.equal(fallback.status(), REALTIME_STATUS.DISCONNECTED);
});

test('repeated connection errors count as one drop', async () => {
  const { clock, calls, fallback } = setup();
  fallback.lost();
  fallback.lost();
  fallback.lost();

  assert.deepEqual(clock.pendingDelays(), [8000, 15000]);
  assert.deepEqual(calls.statuses, [REALTIME_STATUS.RECONNECTING]);
});

test('while down, it probes with backoff and stops at the longest delay', async () => {
  const { clock, calls, fallback } = setup();
  fallback.lost();

  await clock.advance(15000);
  assert.equal(calls.probe, 1);
  await clock.advance(30000);
  assert.equal(calls.probe, 2);
  await clock.advance(60000);
  assert.equal(calls.probe, 3);
  await clock.advance(60000);
  assert.equal(calls.probe, 4);
  assert.equal(calls.refresh, 0, 'nothing changed, nothing reloaded');
});

test('a probe that sees a change refreshes the activity', async () => {
  let changes = [false, true];
  const { clock, calls, fallback } = setup({ probeResult: () => changes.shift() ?? false });
  fallback.lost();

  await clock.advance(15000);
  assert.equal(calls.refresh, 0);
  await clock.advance(30000);
  assert.equal(calls.refresh, 1);
});

test('polling stops once the socket connects again', async () => {
  const { clock, calls, fallback } = setup();
  fallback.lost();
  await clock.advance(15000);
  fallback.connected();
  await clock.advance(200000);

  assert.equal(calls.probe, 1);
});

test('jitter spreads the poll delays', () => {
  const clock = createClock();
  for (const [random, expected] of [[0, 12000], [1, 18000]]) {
    const fallback = createRealtimeFallback({
      refresh: async () => {},
      probe: async () => false,
      timers: clock.timers,
      now: clock.now,
      random: () => random,
      options: { ...OPTIONS, jitter: 0.2 }
    });
    fallback.lost();
    assert.ok(clock.pendingDelays().includes(expected), `random ${random}`);
    fallback.dispose();
  }
});

test('the page becoming visible probes while down, at most every minProbeGapMs', async () => {
  const { clock, calls, fallback } = setup();

  fallback.pageVisible();
  await flush();
  assert.equal(calls.probe, 0, 'nothing to do while connected or connecting');

  fallback.lost();
  fallback.pageVisible();
  await flush();
  assert.equal(calls.probe, 1);
  fallback.pageVisible();
  await flush();
  assert.equal(calls.probe, 1, 'throttled');
  await clock.advance(5000);
  fallback.pageVisible();
  await flush();
  assert.equal(calls.probe, 2);
});

test('refreshes never overlap: requests during one run it once more', async () => {
  const runs = [];
  const { calls, fallback } = setup({
    refreshImpl: async () => {
      const run = deferred();
      runs.push(run);
      calls.refresh += 1;
      await run.promise;
    }
  });

  const first = fallback.refreshNow();
  const second = fallback.refreshNow();
  fallback.refreshNow();
  await flush();
  assert.equal(calls.refresh, 1);

  runs[0].resolve();
  await flush();
  assert.equal(calls.refresh, 2, 'the queued requests run once');
  runs[1].resolve();
  await Promise.all([first, second]);
  assert.equal(calls.refresh, 2);
});

test('a probe is skipped while a refresh runs', async () => {
  const run = deferred();
  const { clock, calls, fallback } = setup({
    refreshImpl: async () => {
      calls.refresh += 1;
      await run.promise;
    }
  });
  fallback.lost();
  fallback.refreshNow();
  await clock.advance(15000);

  assert.equal(calls.probe, 0);
  run.resolve();
  await flush();
});

test('failed probes and refreshes are reported and polling goes on', async () => {
  const { clock, calls, fallback } = setup({
    probeImpl: async () => {
      calls.probe += 1;
      throw new Error('offline');
    }
  });
  fallback.lost();
  await clock.advance(15000);
  await clock.advance(30000);

  assert.equal(calls.probe, 2);
  assert.deepEqual(calls.errors, ['probe', 'probe']);

  const failing = setup({
    refreshImpl: async () => {
      throw new Error('500');
    }
  });
  assert.equal(await failing.fallback.refreshNow(), false);
  assert.deepEqual(failing.calls.errors, ['refresh']);
  assert.equal(await setup().fallback.refreshNow(), true);
});

test('dispose stops every timer and ignores later events', async () => {
  const { clock, calls, fallback } = setup();
  fallback.lost();
  fallback.dispose();
  await clock.advance(200000);
  fallback.connected();
  await fallback.refreshNow();

  assert.equal(calls.probe, 0);
  assert.equal(calls.refresh, 0);
  assert.deepEqual(clock.pendingDelays(), []);
});

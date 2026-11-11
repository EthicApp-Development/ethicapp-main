import assert from 'node:assert/strict';
import test from 'node:test';
import { HIDDEN_TIMER_SNAPSHOT, createPhaseClockTracker } from '../phaseClockTracker.js';

const T0 = Date.parse('2026-11-11T15:00:00.000Z');
const MINUTE = 60 * 1000;
// Ticks land a few milliseconds after the shown second changes.
const TICK = 10;

// A manual device clock with timers that fire when time advances. `sleep`
// moves the time without firing them, as a background tab or a sleeping
// phone does.
function createClock(start = T0) {
  let current = start;
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
    pendingCount: () => pending.size,
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
    },
    sleep(ms) {
      current += ms;
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

// The server's phase clock. Its time runs `skewMs` ahead of the device's.
function createServer(clock, { skewMs = 0, ...phase } = {}) {
  const state = {
    sessionId: 7,
    timeMode: 'soft',
    finished: false,
    phaseId: 31,
    phaseNumber: 1,
    startedAt: new Date(T0 + skewMs).toISOString(),
    endsAt: new Date(T0 + skewMs + 10 * MINUTE).toISOString(),
    isLastPhase: false,
    ...phase
  };
  return {
    state,
    set(changes) {
      Object.assign(state, changes);
    },
    body() {
      return { ...state, serverNow: new Date(clock.now() + skewMs).toISOString() };
    },
    serverTime(deviceMs) {
      return new Date(deviceMs + skewMs).toISOString();
    }
  };
}

function setup({ server: serverOptions = {}, fetchImpl = null, start = T0 } = {}) {
  const clock = createClock(start);
  const server = createServer(clock, serverOptions);
  const calls = { fetch: 0, changes: [], errors: [] };
  const tracker = createPhaseClockTracker({
    sessionId: 7,
    fetchClock: fetchImpl ?? (async (sessionId) => {
      calls.fetch += 1;
      assert.equal(sessionId, 7);
      return server.body();
    }),
    onChange: (snapshot) => calls.changes.push(snapshot),
    onError: (error) => calls.errors.push(error),
    timers: clock.timers,
    now: clock.now
  });
  return { clock, server, calls, tracker };
}

function announcements(calls) {
  const seen = new Map();
  calls.changes.forEach(({ announcement }) => {
    if (announcement) seen.set(announcement.id, announcement.kind);
  });
  return [...seen.values()];
}

test('the first read shows the time left, with nothing announced', async () => {
  const { calls, tracker } = setup();
  assert.deepEqual(tracker.snapshot(), HIDDEN_TIMER_SNAPSHOT);

  await tracker.start();

  const snapshot = tracker.snapshot();
  assert.equal(calls.fetch, 1);
  assert.equal(snapshot.state, 'running');
  assert.equal(snapshot.display, '10:00');
  assert.equal(snapshot.remainingSeconds, 600);
  assert.equal(snapshot.timeMode, 'soft');
  assert.equal(snapshot.phaseId, 31);
  assert.equal(snapshot.announcement, null);
});

test('the count follows the server time, not the device clock', async () => {
  // The device is 3 minutes behind the server.
  const { clock, tracker } = setup({ server: { skewMs: 3 * MINUTE } });
  await tracker.start();

  assert.equal(tracker.snapshot().display, '10:00');
  assert.equal(tracker.snapshot().deadlineAt, T0 + 10 * MINUTE);

  await clock.advance(61 * 1000 + TICK);
  assert.equal(tracker.snapshot().display, '08:59');
});

test('ticks land on each change of the shown second', async () => {
  const { clock, server, calls, tracker } = setup();
  server.set({ endsAt: new Date(T0 + 10 * 1000 + 400).toISOString() });
  await tracker.start();
  assert.equal(tracker.snapshot().display, '00:11');

  await clock.advance(399);
  assert.equal(tracker.snapshot().display, '00:11');
  await clock.advance(10);
  assert.equal(tracker.snapshot().display, '00:10');
  await clock.advance(1000);
  assert.equal(tracker.snapshot().display, '00:09');

  const displays = calls.changes.map(({ display }) => display);
  assert.deepEqual(displays, ['00:11', '00:10', '00:09']);
});

test('nothing is shown without a countdown', async (t) => {
  const cases = {
    'mode none': { timeMode: 'none', endsAt: null },
    'a phase without a duration': { endsAt: null },
    'no phase yet': { phaseId: null, phaseNumber: null, startedAt: null, endsAt: null, isLastPhase: null },
    'a finished activity': { finished: true, phaseId: null, phaseNumber: null, endsAt: null }
  };

  for (const [name, phase] of Object.entries(cases)) {
    await t.test(name, async () => {
      const { clock, tracker } = setup({ server: phase });
      await tracker.start();
      assert.equal(tracker.snapshot().state, 'hidden');
      assert.equal(clock.pendingCount(), 0);
    });
  }
});

test('soft mode: the last minute, then time up, never below zero', async () => {
  const { clock, calls, tracker } = setup();
  await tracker.start();

  await clock.advance(5 * MINUTE + TICK);
  assert.equal(tracker.snapshot().display, '05:00');

  await clock.advance(4 * MINUTE + 1000);
  assert.equal(tracker.snapshot().state, 'lastMinute');
  assert.equal(tracker.snapshot().display, '00:59');

  await clock.advance(59 * 1000);
  const timeUp = tracker.snapshot();
  assert.equal(timeUp.state, 'timeUp');
  assert.equal(timeUp.display, '00:00');
  assert.equal(timeUp.deadlineReached, true);
  assert.equal(timeUp.hardDeadline, false);

  await clock.advance(10 * MINUTE);
  assert.equal(tracker.snapshot().state, 'timeUp');
  assert.equal(tracker.snapshot().remainingSeconds, 0);
  assert.ok(calls.changes.every(({ remainingSeconds }) => remainingSeconds === null || remainingSeconds >= 0));
  assert.deepEqual(announcements(calls), ['fiveMinutes', 'oneMinute', 'timeUp']);
});

test('hard mode waits for the next phase; on the last phase it says time is up', async () => {
  const hard = setup({ server: { timeMode: 'hard' } });
  await hard.tracker.start();
  assert.equal(hard.tracker.snapshot().hardDeadline, true);
  await hard.clock.advance(10 * MINUTE + TICK);
  assert.equal(hard.tracker.snapshot().state, 'advancing');
  assert.equal(hard.tracker.snapshot().deadlineReached, true);
  assert.deepEqual(announcements(hard.calls).at(-1), 'advancing');

  const last = setup({ server: { timeMode: 'hard', isLastPhase: true } });
  await last.tracker.start();
  await last.clock.advance(10 * MINUTE + TICK);
  assert.equal(last.tracker.snapshot().state, 'timeUp');
  assert.deepEqual(announcements(last.calls).at(-1), 'timeUp');
});

test('after a sleep the page shows the right time at once, says the latest milestone and reads the clock', async () => {
  const { clock, calls, tracker } = setup();
  await tracker.start();
  await clock.advance(3 * MINUTE + TICK);
  assert.equal(tracker.snapshot().display, '07:00');

  // Six and a half minutes in the background, with no timer fired.
  clock.sleep(6.5 * MINUTE);
  assert.equal(tracker.snapshot().display, '07:00');

  const visible = tracker.pageVisible();
  assert.equal(tracker.snapshot().display, '00:30');
  assert.equal(tracker.snapshot().state, 'lastMinute');
  await visible;

  assert.equal(calls.fetch, 2);
  assert.deepEqual(announcements(calls), ['oneMinute']);
});

test('a reconnect reads the clock again', async () => {
  const { server, calls, tracker } = setup();
  await tracker.start();

  // "+1 min" while the socket was down.
  server.set({ endsAt: new Date(T0 + 11 * MINUTE).toISOString() });
  await tracker.reconnected();

  assert.equal(calls.fetch, 2);
  assert.equal(tracker.snapshot().display, '11:00');
  assert.equal(tracker.snapshot().extended, true);
});

test('added time is shown for a while and announced once', async () => {
  const { clock, server, calls, tracker } = setup();
  await tracker.start();
  await clock.advance(9 * MINUTE + 30 * 1000);
  assert.equal(tracker.snapshot().state, 'lastMinute');

  server.set({ endsAt: new Date(T0 + 11 * MINUTE).toISOString() });
  tracker.handleClock(server.body());

  const extended = tracker.snapshot();
  assert.equal(extended.state, 'running');
  assert.equal(extended.display, '01:30');
  assert.equal(extended.extended, true);
  assert.deepEqual(extended.announcement, { kind: 'extended', id: extended.announcement.id, remainingSeconds: 90 });

  await clock.advance(10 * 1000 + TICK);
  assert.equal(tracker.snapshot().extended, false);
  assert.equal(announcements(calls).filter((kind) => kind === 'extended').length, 1);

  // The same clock again adds nothing.
  tracker.handleClock(server.body());
  assert.equal(tracker.snapshot().extended, false);
});

test('clocks of another session, read earlier or for an earlier phase are ignored', async () => {
  const { clock, server, tracker } = setup({ server: { phaseId: 32, phaseNumber: 2 } });
  await tracker.start();
  const older = server.body();

  await clock.advance(1000);
  tracker.handleClock({ ...server.body(), sessionId: 8, endsAt: null });
  assert.equal(tracker.snapshot().state, 'running');

  server.set({ endsAt: new Date(T0 + 20 * MINUTE).toISOString() });
  tracker.handleClock(server.body());
  assert.equal(tracker.snapshot().display, '19:59');

  tracker.handleClock(older);
  assert.equal(tracker.snapshot().display, '19:59');

  tracker.handleClock({ ...server.body(), phaseId: 31, phaseNumber: 1 });
  assert.equal(tracker.snapshot().phaseId, 32);

  tracker.handleClock('not a clock');
  assert.equal(tracker.snapshot().phaseId, 32);
});

test('a transition hides the old phase at once and takes the clock that follows it', async () => {
  const { clock, server, calls, tracker } = setup({ server: { timeMode: 'hard' } });
  await tracker.start();
  await clock.advance(10 * MINUTE + TICK);
  assert.equal(tracker.snapshot().state, 'advancing');
  const oldPhase = server.body();

  await clock.advance(500);
  tracker.handlePhaseTransition({ sessionId: 7, phaseId: 32, phaseNumber: 2, reason: 'deadline' });
  assert.equal(tracker.snapshot().state, 'hidden');

  // A late answer for the old phase changes nothing.
  tracker.handleClock(oldPhase);
  assert.equal(tracker.snapshot().state, 'hidden');

  server.set({
    phaseId: 32,
    phaseNumber: 2,
    startedAt: new Date(clock.now()).toISOString(),
    endsAt: new Date(clock.now() + 5 * MINUTE).toISOString()
  });
  tracker.handleClock(server.body());

  const snapshot = tracker.snapshot();
  assert.equal(snapshot.phaseId, 32);
  assert.equal(snapshot.display, '05:00');
  assert.deepEqual(snapshot.announcement, { kind: 'newPhase', id: snapshot.announcement.id, remainingSeconds: 300 });

  const fetchesBefore = calls.fetch;
  await clock.advance(5000);
  assert.equal(calls.fetch, fetchesBefore, 'the clock event arrived, so no read is needed');
});

test('a transition without a following clock reads the clock', async () => {
  const { clock, server, calls, tracker } = setup();
  await tracker.start();

  server.set({ phaseId: 32, phaseNumber: 2, endsAt: null });
  tracker.handlePhaseTransition({ sessionId: 7, phaseId: 32, phaseNumber: 2, reason: 'teacher' });
  await clock.advance(2999);
  assert.equal(calls.fetch, 1);
  await clock.advance(1);
  assert.equal(calls.fetch, 2);
  assert.equal(tracker.snapshot().state, 'hidden');
});

test('transitions of another session or to a phase already shown are ignored', async () => {
  const { clock, calls, tracker } = setup({ server: { phaseId: 32, phaseNumber: 2 } });
  await tracker.start();

  tracker.handlePhaseTransition({ sessionId: 8, phaseId: 40, phaseNumber: 3 });
  tracker.handlePhaseTransition({ sessionId: 7, phaseId: 32, phaseNumber: 2 });
  await clock.advance(5000);

  assert.equal(tracker.snapshot().state, 'running');
  assert.equal(calls.fetch, 1);
});

test('at 00:00 the clock is read once more; a hard phase keeps checking until it moves on', async () => {
  const soft = setup();
  await soft.tracker.start();
  await soft.clock.advance(10 * MINUTE + TICK);
  await soft.clock.advance(3000);
  assert.equal(soft.calls.fetch, 2);
  await soft.clock.advance(60 * 1000);
  assert.equal(soft.calls.fetch, 2);

  const hard = setup({ server: { timeMode: 'hard' } });
  await hard.tracker.start();
  await hard.clock.advance(10 * MINUTE + TICK + 3000);
  assert.equal(hard.calls.fetch, 2);
  await hard.clock.advance(10 * 1000);
  assert.equal(hard.calls.fetch, 3);

  // The server started the next phase while the socket was down.
  hard.server.set({ phaseId: 32, phaseNumber: 2, endsAt: new Date(hard.clock.now() + 5 * MINUTE).toISOString() });
  await hard.clock.advance(10 * 1000);
  assert.equal(hard.calls.fetch, 4);
  assert.equal(hard.tracker.snapshot().state, 'running');
  await hard.clock.advance(60 * 1000);
  assert.equal(hard.calls.fetch, 4);
});

test('the page seeing another phase makes the clock read again', async () => {
  const { server, calls, tracker } = setup();
  const first = tracker.start();
  // While the first read runs, the page's phase changes nothing.
  await tracker.phaseChanged(31);
  await first;
  assert.equal(calls.fetch, 1);

  await tracker.phaseChanged(31);
  assert.equal(calls.fetch, 1);

  server.set({ phaseId: 32, phaseNumber: 2 });
  await tracker.phaseChanged(32);
  assert.equal(calls.fetch, 2);
  assert.equal(tracker.snapshot().phaseId, 32);

  await tracker.phaseChanged(null);
  assert.equal(calls.fetch, 2);
});

test('reads never overlap, and a slow older answer never replaces a newer one', async () => {
  const answers = [];
  const { clock, server, tracker } = setup({
    fetchImpl: () => {
      const answer = deferred();
      answers.push(answer);
      return answer.promise;
    }
  });

  tracker.start();
  tracker.reconnected();
  tracker.reconnected();
  assert.equal(answers.length, 1);

  const firstBody = server.body();
  await clock.advance(1000);
  answers[0].resolve(firstBody);
  await flush();
  assert.equal(answers.length, 2, 'the queued reads run once');

  server.set({ endsAt: new Date(T0 + 12 * MINUTE).toISOString() });
  const newer = server.body();
  tracker.handleClock(newer);
  assert.equal(tracker.snapshot().display, '11:59');

  // The queued read was answered before the event, so it is older.
  answers[1].resolve({ ...firstBody, serverNow: server.serverTime(T0 + 500) });
  await flush();
  assert.equal(tracker.snapshot().display, '11:59');
});

test('a failed read keeps the clock shown and reports the error', async () => {
  let fail = false;
  const clock = createClock();
  const server = createServer(clock);
  const errors = [];
  const tracker = createPhaseClockTracker({
    sessionId: 7,
    fetchClock: async () => {
      if (fail) throw new Error('offline');
      return server.body();
    },
    onError: (error) => errors.push(error.message),
    timers: clock.timers,
    now: clock.now
  });

  await tracker.start();
  fail = true;
  await tracker.reconnected();
  assert.deepEqual(errors, ['offline']);
  assert.equal(tracker.snapshot().state, 'running');
});

test('dispose stops the ticks and ignores late answers', async () => {
  const answer = deferred();
  const { clock, server, calls, tracker } = setup({ fetchImpl: () => answer.promise });

  const started = tracker.start();
  tracker.dispose();
  answer.resolve(server.body());
  await started;
  assert.equal(tracker.snapshot().state, 'hidden');
  assert.equal(calls.changes.length, 0);

  const running = setup();
  await running.tracker.start();
  running.tracker.dispose();
  assert.equal(running.clock.pendingCount(), 0);
  running.tracker.handleClock(running.server.body());
  running.tracker.handlePhaseTransition({ sessionId: 7, phaseId: 40, phaseNumber: 3 });
  await clock.advance(5000);
  assert.equal(running.clock.pendingCount(), 0);
});

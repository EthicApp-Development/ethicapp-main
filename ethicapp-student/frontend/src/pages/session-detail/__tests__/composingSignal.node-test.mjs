import assert from 'node:assert/strict';
import test from 'node:test';
import { createComposingSignal } from '../composingSignal.js';
import {
  CHAT_COMPOSING_EVENT,
  COMPOSING_CLIENT_INTERVAL_MS,
  COMPOSING_IDLE_MS
} from '../../../utils/composingSignalContract.js';

const SECOND = 1000;
const TARGET = Object.freeze({ phaseId: 31, questionId: 501, groupId: 12 });

// A manual clock with timers that fire when time advances.
function createClock(start = 0) {
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
    advance(ms) {
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
      }
      current = target;
    }
  };
}

// A Socket.IO client stand-in that records what is emitted, and when.
function createSocket(clock, { connected = true } = {}) {
  const sent = [];
  return {
    connected,
    sent,
    kinds: () => sent.map(({ payload }) => payload.kind),
    emit(event, payload) {
      sent.push({ event, payload, at: clock.now() });
    }
  };
}

function setup({ socket: socketOptions, ...target } = {}) {
  const clock = createClock();
  const socket = createSocket(clock, socketOptions);
  const signal = createComposingSignal({ timers: clock.timers, now: clock.now });
  signal.update({ socket, ...TARGET, enabled: true, ...target });
  return { clock, socket, signal };
}

// Edits every `everyMs` for `forMs`, as a student typing.
function type(clock, signal, { forMs, everyMs }) {
  const end = clock.now() + forMs;
  while (clock.now() < end) {
    signal.edited();
    clock.advance(everyMs);
  }
}

test('the first edit sends composing with the target and nothing else', () => {
  const { socket, signal } = setup();

  signal.edited();

  assert.deepEqual(socket.sent, [{
    event: CHAT_COMPOSING_EVENT,
    payload: { ...TARGET, kind: 'composing' },
    at: 0
  }]);
});

test('ids given as strings are sent as numbers', () => {
  const { socket, signal } = setup({ phaseId: '31', questionId: '501', groupId: '12' });

  signal.edited();

  assert.deepEqual(socket.sent[0].payload, { ...TARGET, kind: 'composing' });
});

test('edits within the interval send nothing more, and the next one after it sends composing again', () => {
  const { clock, socket, signal } = setup();

  signal.edited();
  clock.advance(COMPOSING_CLIENT_INTERVAL_MS - 1);
  signal.edited();
  assert.deepEqual(socket.kinds(), ['composing']);

  clock.advance(1);
  signal.edited();
  assert.deepEqual(socket.kinds(), ['composing', 'composing']);
  assert.deepEqual(socket.sent.map(({ at }) => at), [0, COMPOSING_CLIENT_INTERVAL_MS]);
});

test('60 s of continuous typing emits at most 13 signals, however many keypresses', () => {
  for (const everyMs of [20, 37, 150, 400, 1000]) {
    const { clock, socket, signal } = setup();

    type(clock, signal, { forMs: 60 * SECOND, everyMs });
    clock.advance(COMPOSING_IDLE_MS);

    assert.ok(socket.sent.length <= 13, `${socket.sent.length} signals with an edit every ${everyMs} ms`);
    assert.equal(socket.kinds().at(-1), 'stopped');
    assert.equal(socket.kinds().filter((kind) => kind === 'stopped').length, 1);
  }
});

test('no 60 s window of three minutes of typing holds more than 13 signals', () => {
  const { clock, socket, signal } = setup();

  type(clock, signal, { forMs: 180 * SECOND, everyMs: 30 });
  clock.advance(COMPOSING_IDLE_MS);

  const times = socket.sent.map(({ at }) => at);
  const busiest = Math.max(...times.map((start) => times.filter((at) => at >= start && at <= start + 60 * SECOND).length));
  assert.ok(busiest <= 13, `${busiest} signals in one minute`);
});

test('composing goes out on edits only: a pause with no edits sends nothing until the idle stop', () => {
  const { clock, socket, signal } = setup();

  signal.edited();
  clock.advance(COMPOSING_IDLE_MS - 1);
  assert.deepEqual(socket.kinds(), ['composing']);
});

test('stopped goes out once after the idle time since the last edit', () => {
  const { clock, socket, signal } = setup();

  signal.edited();
  clock.advance(6 * SECOND);
  signal.edited();
  clock.advance(COMPOSING_IDLE_MS - 1);
  assert.deepEqual(socket.kinds(), ['composing', 'composing']);

  clock.advance(1);
  assert.deepEqual(socket.kinds(), ['composing', 'composing', 'stopped']);
  assert.equal(socket.sent.at(-1).at, 6 * SECOND + COMPOSING_IDLE_MS);
  assert.deepEqual(socket.sent.at(-1).payload, { ...TARGET, kind: 'stopped' });
  assert.equal(clock.pendingCount(), 0);

  clock.advance(60 * SECOND);
  assert.equal(socket.sent.length, 3);
});

test('an edit after a stop starts again with composing at once', () => {
  const { clock, socket, signal } = setup();

  signal.edited();
  signal.stop();
  clock.advance(100);
  signal.edited();

  assert.deepEqual(socket.kinds(), ['composing', 'stopped', 'composing']);
});

test('blur and submit (stop) send stopped and cancel the idle timer', () => {
  const { clock, socket, signal } = setup();

  signal.edited();
  signal.stop();

  assert.deepEqual(socket.kinds(), ['composing', 'stopped']);
  assert.equal(clock.pendingCount(), 0);
  clock.advance(60 * SECOND);
  assert.equal(socket.sent.length, 2);
});

test('stop sends nothing without a composing before it', () => {
  const { clock, socket, signal } = setup();

  signal.stop();
  signal.edited();
  signal.stop();
  signal.stop();
  clock.advance(60 * SECOND);

  assert.deepEqual(socket.kinds(), ['composing', 'stopped']);
});

for (const [change, value] of [['group', { groupId: 13 }], ['phase', { phaseId: 32 }], ['question', { questionId: 502 }]]) {
  test(`a ${change} change sends stopped to the previous target`, () => {
    const { clock, socket, signal } = setup();

    signal.edited();
    signal.update({ socket, ...TARGET, ...value, enabled: true });

    assert.deepEqual(socket.sent.map(({ payload }) => payload), [
      { ...TARGET, kind: 'composing' },
      { ...TARGET, kind: 'stopped' }
    ]);
    assert.equal(clock.pendingCount(), 0);

    signal.edited();
    assert.deepEqual(socket.sent.at(-1).payload, { ...TARGET, ...value, kind: 'composing' });
  });
}

test('the chat closing for the student (a phase change, read-only, closed) sends stopped and then nothing', () => {
  const { clock, socket, signal } = setup();

  signal.edited();
  signal.update({ socket, ...TARGET, enabled: false });
  signal.edited();
  clock.advance(60 * SECOND);

  assert.deepEqual(socket.kinds(), ['composing', 'stopped']);
  assert.equal(clock.pendingCount(), 0);
});

test('an update with the same target keeps composing going', () => {
  const { clock, socket, signal } = setup();

  signal.edited();
  signal.update({ socket, ...TARGET, enabled: true });
  clock.advance(COMPOSING_CLIENT_INTERVAL_MS);
  signal.edited();

  assert.deepEqual(socket.kinds(), ['composing', 'composing']);
});

test('dispose (unmount) sends stopped and leaves no timer', () => {
  const { clock, socket, signal } = setup();

  signal.edited();
  assert.equal(clock.pendingCount(), 1);
  signal.dispose();

  assert.deepEqual(socket.kinds(), ['composing', 'stopped']);
  assert.equal(clock.pendingCount(), 0);

  signal.edited();
  signal.update({ socket, ...TARGET, enabled: true });
  signal.edited();
  signal.stop();
  clock.advance(60 * SECOND);
  assert.deepEqual(socket.kinds(), ['composing', 'stopped']);
  assert.equal(clock.pendingCount(), 0);
});

test('dispose without a composing sends nothing', () => {
  const { clock, socket, signal } = setup();

  signal.dispose();

  assert.equal(socket.sent.length, 0);
  assert.equal(clock.pendingCount(), 0);
});

test('a read-only chat emits nothing', () => {
  const { clock, socket, signal } = setup({ enabled: false });

  type(clock, signal, { forMs: 20 * SECOND, everyMs: 100 });
  signal.stop();
  signal.dispose();
  clock.advance(60 * SECOND);

  assert.equal(socket.sent.length, 0);
  assert.equal(clock.pendingCount(), 0);
});

test('without a socket (the view polls) nothing is emitted', () => {
  const clock = createClock();
  const signal = createComposingSignal({ timers: clock.timers, now: clock.now });
  signal.update({ socket: null, ...TARGET, enabled: true });

  type(clock, signal, { forMs: 20 * SECOND, everyMs: 100 });
  signal.dispose();

  assert.equal(clock.pendingCount(), 0);
});

test('a socket that is not connected emits nothing', () => {
  const { clock, socket, signal } = setup({ socket: { connected: false } });

  type(clock, signal, { forMs: 20 * SECOND, everyMs: 100 });
  signal.stop();
  signal.dispose();

  assert.equal(socket.sent.length, 0);
  assert.equal(clock.pendingCount(), 0);
});

test('an incomplete target emits nothing', () => {
  for (const missing of [{ groupId: null }, { phaseId: 0 }, { questionId: Number.NaN }, { groupId: 'abc' }]) {
    const { clock, socket, signal } = setup(missing);

    signal.edited();
    clock.advance(60 * SECOND);

    assert.equal(socket.sent.length, 0);
  }
});

test('losing the socket while composing stops without emitting, and its return starts afresh', () => {
  const { clock, socket, signal } = setup();

  signal.edited();
  // The view polls once the socket has dropped: the stopped cannot go out,
  // and is not queued for the reconnect.
  socket.connected = false;
  signal.update({ socket: null, ...TARGET, enabled: true });
  assert.equal(clock.pendingCount(), 0);
  type(clock, signal, { forMs: 10 * SECOND, everyMs: 100 });
  assert.deepEqual(socket.kinds(), ['composing']);

  socket.connected = true;
  signal.update({ socket, ...TARGET, enabled: true });
  signal.edited();
  assert.deepEqual(socket.kinds(), ['composing', 'composing']);
});

test('a socket that drops before the stop sends nothing more and leaves no timer', () => {
  const { clock, socket, signal } = setup();

  signal.edited();
  socket.connected = false;
  clock.advance(COMPOSING_IDLE_MS);

  assert.deepEqual(socket.kinds(), ['composing']);
  assert.equal(clock.pendingCount(), 0);
});

test('an emit that throws is ignored, and the next edit tries again', () => {
  const clock = createClock();
  let fail = true;
  const sent = [];
  const socket = {
    connected: true,
    emit(event, payload) {
      if (fail) throw new Error('transport closed');
      sent.push(payload.kind);
    }
  };
  const signal = createComposingSignal({ timers: clock.timers, now: clock.now });
  signal.update({ socket, ...TARGET, enabled: true });

  assert.doesNotThrow(() => signal.edited());
  assert.equal(clock.pendingCount(), 0);

  fail = false;
  signal.edited();
  fail = true;
  assert.doesNotThrow(() => signal.stop());
  assert.deepEqual(sent, ['composing']);
  assert.equal(clock.pendingCount(), 0);
});

test('no payload carries anything but the target and the kind', () => {
  const { clock, socket, signal } = setup();

  type(clock, signal, { forMs: 30 * SECOND, everyMs: 50 });
  signal.stop();
  signal.edited();
  signal.update({ socket, ...TARGET, groupId: 99, enabled: true });
  signal.edited();
  signal.dispose();

  assert.ok(socket.sent.length > 0);
  for (const { event, payload } of socket.sent) {
    assert.equal(event, CHAT_COMPOSING_EVENT);
    assert.deepEqual(Object.keys(payload).sort(), ['groupId', 'kind', 'phaseId', 'questionId']);
    assert.ok(['composing', 'stopped'].includes(payload.kind));
  }
});

test('edited() takes no argument, so the draft cannot reach it', () => {
  const { signal } = setup();

  assert.equal(signal.edited.length, 0);
});

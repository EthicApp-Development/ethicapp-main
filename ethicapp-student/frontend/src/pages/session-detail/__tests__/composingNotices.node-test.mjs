import assert from 'node:assert/strict';
import test from 'node:test';
import { createComposingNotices } from '../composingNotices.js';
import { COMPOSING_NOTICE_TTL_MS } from '../../../utils/composingSignalContract.js';

const SECOND = 1000;
const SELF = 7;
const TARGET = Object.freeze({ phaseId: 31, groupId: 12, questionId: 501, selfUserId: SELF });
const LOAD = Object.freeze({ groupId: TARGET.groupId, questionId: TARGET.questionId });

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

function setup(target = {}) {
  const clock = createClock();
  const changes = [];
  const notices = createComposingNotices({
    timers: clock.timers,
    now: clock.now,
    onChange: (writers) => changes.push(writers)
  });
  notices.update({ ...TARGET, enabled: true, ...target });
  const ids = () => notices.writers().map(({ userId }) => userId);
  return { clock, notices, changes, ids };
}

function notice(userId, kind = 'composing', extra = {}) {
  return { groupId: TARGET.groupId, questionId: TARGET.questionId, userId, role: 'A', name: `User ${userId}`, kind, ...extra };
}

test('a composing notice adds its writer with the role and name as sent', () => {
  const { notices, changes } = setup();

  notices.receive(notice(21, 'composing', { name: 'Ana' }));
  notices.receive(notice(3, 'composing', { role: 'P', name: null }));

  assert.deepEqual(notices.writers(), [
    { userId: 21, role: 'A', name: 'Ana' },
    { userId: 3, role: 'P', name: null }
  ]);
  assert.equal(changes.length, 2);
});

test('a writer expires one TTL after their last composing, as after a lost stopped', () => {
  const { clock, notices, ids, changes } = setup();

  notices.receive(notice(21));
  clock.advance(COMPOSING_NOTICE_TTL_MS - 1);
  assert.deepEqual(ids(), [21]);

  clock.advance(1);
  assert.deepEqual(ids(), []);
  assert.deepEqual(changes.at(-1), []);
  assert.equal(clock.pendingCount(), 0);
});

test('a newer composing extends the expiry without reporting a change', () => {
  const { clock, notices, ids, changes } = setup();

  notices.receive(notice(21));
  clock.advance(6 * SECOND);
  notices.receive(notice(21));
  assert.equal(changes.length, 1);

  clock.advance(COMPOSING_NOTICE_TTL_MS - 1);
  assert.deepEqual(ids(), [21]);
  clock.advance(1);
  assert.deepEqual(ids(), []);
  assert.equal(changes.length, 2);
});

test('each writer expires on their own clock, and the others stay in start order', () => {
  const { clock, notices, ids } = setup();

  notices.receive(notice(21));
  clock.advance(3 * SECOND);
  notices.receive(notice(22));
  clock.advance(3 * SECOND);
  notices.receive(notice(23));
  notices.receive(notice(21));
  assert.deepEqual(ids(), [21, 22, 23]);

  clock.advance(COMPOSING_NOTICE_TTL_MS - 3 * SECOND);
  assert.deepEqual(ids(), [21, 23]);
  clock.advance(3 * SECOND);
  assert.deepEqual(ids(), []);
});

test('stopped removes the writer at once, and a stopped for nobody changes nothing', () => {
  const { notices, ids, changes } = setup();

  notices.receive(notice(21));
  notices.receive(notice(22));
  notices.receive(notice(21, 'stopped'));
  assert.deepEqual(ids(), [22]);
  assert.equal(changes.length, 3);

  notices.receive(notice(21, 'stopped'));
  assert.equal(changes.length, 3);
});

test('the student\'s own notices, from another tab of theirs, are ignored', () => {
  const { notices, ids, changes } = setup();

  notices.receive(notice(SELF));
  notices.receive(notice(String(SELF)));

  assert.deepEqual(ids(), []);
  assert.equal(changes.length, 0);
});

test('notices of another group or question are ignored', () => {
  const { notices, ids } = setup();

  notices.receive(notice(21, 'composing', { groupId: 13 }));
  notices.receive(notice(22, 'composing', { questionId: 502 }));
  notices.receive(notice(23, 'composing', { groupId: '12', questionId: '501' }));

  assert.deepEqual(ids(), [23]);
});

test('malformed notices are ignored', () => {
  const { notices, ids, changes } = setup();

  for (const malformed of [null, 'composing', {}, notice(0), notice(-1), notice(1.5), notice(21, 'typing'), notice(21, undefined, { kind: undefined })]) {
    notices.receive(malformed);
  }

  assert.deepEqual(ids(), []);
  assert.equal(changes.length, 0);
});

test('an unknown role counts as a participant, and a blank name as no name', () => {
  const { notices } = setup();

  notices.receive(notice(21, 'composing', { role: 'S', name: '   ' }));

  assert.deepEqual(notices.writers(), [{ userId: 21, role: 'A', name: null }]);
});

test('a change of group, phase or question, or the chat closing, forgets every writer', () => {
  for (const change of [{ groupId: 13 }, { phaseId: 32 }, { questionId: 502 }, { enabled: false }, { selfUserId: 8 }]) {
    const { clock, notices, ids, changes } = setup();
    notices.receive(notice(21));

    notices.update({ ...TARGET, enabled: true, ...change });

    assert.deepEqual(ids(), [], JSON.stringify(change));
    assert.deepEqual(changes.at(-1), []);
    assert.equal(clock.pendingCount(), 0);
  }
});

test('the same target on a new render keeps the writers', () => {
  const { notices, ids, changes } = setup();
  notices.receive(notice(21));

  notices.update({ ...TARGET, groupId: '12', enabled: true });

  assert.deepEqual(ids(), [21]);
  assert.equal(changes.length, 1);
});

test('nothing is kept while the chat is disabled or its target incomplete', () => {
  for (const target of [{ enabled: false }, { groupId: null }, { questionId: undefined }]) {
    const { notices, ids } = setup(target);

    notices.receive(notice(21));

    assert.deepEqual(ids(), [], JSON.stringify(target));
  }
});

test('reset, as after a reconnect, forgets every writer and cancels the expiry', () => {
  const { clock, notices, ids, changes } = setup();
  notices.receive(notice(21));

  notices.reset();

  assert.deepEqual(ids(), []);
  assert.deepEqual(changes.at(-1), []);
  assert.equal(clock.pendingCount(), 0);
});

test('a new message removes its author, learned from the reloaded transcript', () => {
  const { clock, notices, ids } = setup();
  notices.transcriptLoaded([{ id: 1, authorId: 21 }, { id: 2, authorId: 22 }], { ...LOAD, requestedAt: clock.now() });
  notices.receive(notice(21));
  notices.receive(notice(22));
  notices.receive(notice(23));

  clock.advance(SECOND);
  notices.transcriptLoaded([
    { id: 1, authorId: 21 },
    { id: 2, authorId: 22 },
    { id: 3, authorId: 23 }
  ], { ...LOAD, requestedAt: clock.now() });

  assert.deepEqual(ids(), [21, 22]);
});

test('the first transcript after a target change only records the messages', () => {
  const { clock, notices, ids } = setup();
  notices.receive(notice(21));

  clock.advance(SECOND);
  notices.transcriptLoaded([{ id: 1, authorId: 21 }], { ...LOAD, requestedAt: clock.now() });
  assert.deepEqual(ids(), [21]);

  notices.update({ ...TARGET, questionId: 502, enabled: true });
  notices.receive(notice(21, 'composing', { questionId: 502 }));
  clock.advance(SECOND);
  notices.transcriptLoaded([{ id: 1, authorId: 21 }, { id: 9, authorId: 21 }], { ...LOAD, questionId: 502, requestedAt: clock.now() });
  assert.deepEqual(ids(), [21]);
});

test('a composing that arrives after the load was requested survives the message', () => {
  const { clock, notices, ids } = setup();
  notices.transcriptLoaded([], { ...LOAD, requestedAt: clock.now() });
  notices.receive(notice(21));

  // Ana sends, then starts a new message while the transcript loads.
  clock.advance(SECOND);
  const requestedAt = clock.now();
  clock.advance(200);
  notices.receive(notice(21));
  notices.transcriptLoaded([{ id: 1, authorId: 21 }], { ...LOAD, requestedAt });

  assert.deepEqual(ids(), [21]);
});

test('a transcript of another group or question is ignored, and does not become the baseline', () => {
  const { clock, notices, ids } = setup();
  notices.transcriptLoaded([], { ...LOAD, requestedAt: clock.now() });
  notices.receive(notice(21));

  clock.advance(SECOND);
  notices.transcriptLoaded([{ id: 1, authorId: 21 }], { groupId: 13, questionId: LOAD.questionId, requestedAt: clock.now() });
  notices.transcriptLoaded([{ id: 2, authorId: 21 }], { groupId: LOAD.groupId, questionId: 502, requestedAt: clock.now() });
  assert.deepEqual(ids(), [21]);

  notices.transcriptLoaded([{ id: 3, authorId: 21 }], { ...LOAD, requestedAt: clock.now() });
  assert.deepEqual(ids(), []);
});

test('messages without an id or an author remove nobody', () => {
  const { clock, notices, ids } = setup();
  notices.transcriptLoaded([], { ...LOAD, requestedAt: clock.now() });
  notices.receive(notice(21));

  clock.advance(SECOND);
  notices.transcriptLoaded([{ id: 0.42, authorId: 21 }, { id: 5, authorId: null }], { ...LOAD, requestedAt: clock.now() });

  assert.deepEqual(ids(), [21]);
});

test('dispose cancels the expiry and reports nothing afterwards', () => {
  const { clock, notices, changes } = setup();
  notices.receive(notice(21));

  notices.dispose();
  notices.receive(notice(22));
  notices.update({ ...TARGET, groupId: 13, enabled: true });
  clock.advance(COMPOSING_NOTICE_TTL_MS);

  assert.equal(clock.pendingCount(), 0);
  assert.equal(changes.length, 1);
  assert.deepEqual(notices.writers(), []);
});

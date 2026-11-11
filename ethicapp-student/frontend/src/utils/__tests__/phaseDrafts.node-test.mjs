import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PHASE_DRAFTS_KEY_PREFIX,
  createPhaseDraftStore,
  keepUnsavedDrafts,
  phaseDraftKey,
  sanitizeTaskDrafts,
  unsentDrafts
} from '../phaseDrafts.js';
import { ANSWER_PROBLEMS } from '../semanticDifferentialAnswer.js';

const HOUR = 60 * 60 * 1000;
const SCOPE = { userId: 5, sessionId: 7, phaseId: 31 };

// A Storage with the methods the store uses.
function createMemoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => {
      items.set(key, String(value));
    },
    removeItem: (key) => {
      items.delete(key);
    }
  };
}

function createStore(storage, { start = 1_000_000, ...options } = {}) {
  let current = start;
  const store = createPhaseDraftStore({ getStorage: () => storage, now: () => current, ...options });
  return {
    store,
    advance(ms) {
      current += ms;
    }
  };
}

test('keys drafts by user, session and phase', () => {
  assert.equal(phaseDraftKey(SCOPE), `${PHASE_DRAFTS_KEY_PREFIX}:5:7:31`);
  assert.equal(phaseDraftKey({ userId: 5, sessionId: 7, phaseId: null }), null);
  assert.equal(phaseDraftKey({ userId: 0, sessionId: 7, phaseId: 31 }), null);
  assert.equal(phaseDraftKey({ userId: '5', sessionId: 7, phaseId: 31 }), `${PHASE_DRAFTS_KEY_PREFIX}:5:7:31`);
});

test('keeps only well-formed task drafts', () => {
  assert.deepEqual(sanitizeTaskDrafts({
    3: { value: 2, justification: 'Hola', extra: true },
    4: { value: '2' },
    x: { value: 1 },
    5: null,
    6: { justification: '' }
  }), { 3: { value: 2, justification: 'Hola' }, 6: { justification: '' } });
});

test('saves, restores and removes a phase\'s drafts', () => {
  const storage = createMemoryStorage();
  const { store } = createStore(storage);

  store.save(SCOPE, { 3: { value: 2 }, 4: { justification: 'Borrador' } });
  assert.deepEqual(store.load(SCOPE), { 3: { value: 2 }, 4: { justification: 'Borrador' } });
  assert.deepEqual(store.load({ ...SCOPE, userId: 6 }), {}, 'another user sees nothing');

  store.save(SCOPE, {});
  assert.equal(storage.items.size, 0);
  assert.deepEqual(store.load(SCOPE), {});
});

test('drops drafts not written for the time to live', () => {
  const storage = createMemoryStorage();
  const { store, advance } = createStore(storage, { ttlMs: 24 * HOUR });

  store.save(SCOPE, { 3: { value: 2 } });
  advance(23 * HOUR);
  assert.deepEqual(store.load(SCOPE), { 3: { value: 2 } });

  advance(2 * HOUR);
  assert.deepEqual(store.load(SCOPE), {});
  assert.equal(storage.items.size, 0);
});

test('does not rewrite an unchanged entry, so its age counts from the last change', () => {
  const storage = createMemoryStorage();
  const { store, advance } = createStore(storage, { ttlMs: 10 * HOUR });

  store.save(SCOPE, { 3: { value: 2 } });
  advance(8 * HOUR);
  store.save(SCOPE, { 3: { value: 2 } });
  advance(3 * HOUR);
  assert.deepEqual(store.load(SCOPE), {});
});

test('prunes expired, unreadable and the oldest entries beyond the limit', () => {
  const storage = createMemoryStorage({
    [`${PHASE_DRAFTS_KEY_PREFIX}:5:7:1`]: '{not json',
    'another.app.key': 'kept'
  });
  const { store, advance } = createStore(storage, { ttlMs: 24 * HOUR, maxEntries: 2 });

  store.save({ ...SCOPE, phaseId: 10 }, { 1: { value: 1 } });
  advance(30 * HOUR);
  store.save({ ...SCOPE, phaseId: 11 }, { 1: { value: 1 } });
  advance(HOUR);
  store.save({ ...SCOPE, phaseId: 12 }, { 1: { value: 1 } });
  advance(HOUR);
  store.save({ ...SCOPE, phaseId: 13 }, { 1: { value: 1 } });

  store.prune();

  assert.deepEqual([...storage.items.keys()].sort(), [
    'another.app.key',
    `${PHASE_DRAFTS_KEY_PREFIX}:5:7:12`,
    `${PHASE_DRAFTS_KEY_PREFIX}:5:7:13`
  ]);
});

test('clears every draft on the device and nothing else', () => {
  const storage = createMemoryStorage({ 'another.app.key': 'kept' });
  const { store } = createStore(storage);
  store.save(SCOPE, { 1: { value: 1 } });
  store.save({ ...SCOPE, userId: 9 }, { 1: { value: 1 } });

  store.clearAll();

  assert.deepEqual([...storage.items.keys()], ['another.app.key']);
});

test('keeps nothing and throws nothing when storage is unavailable', () => {
  const blocked = createPhaseDraftStore({
    getStorage: () => {
      throw new Error('SecurityError');
    }
  });
  assert.doesNotThrow(() => blocked.save(SCOPE, { 1: { value: 1 } }));
  assert.deepEqual(blocked.load(SCOPE), {});
  assert.doesNotThrow(() => blocked.prune());
  assert.doesNotThrow(() => blocked.clearAll());

  const missing = createPhaseDraftStore({ getStorage: () => undefined });
  assert.deepEqual(missing.load(SCOPE), {});

  const failing = createPhaseDraftStore({
    getStorage: () => ({
      get length() {
        throw new Error('denied');
      },
      key: () => {
        throw new Error('denied');
      },
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('denied');
      }
    })
  });
  assert.doesNotThrow(() => failing.save(SCOPE, { 1: { value: 1 } }));
  assert.deepEqual(failing.load(SCOPE), {});
  assert.doesNotThrow(() => failing.prune());
  assert.doesNotThrow(() => failing.clearAll());
});

const PHASE = {
  id: 31,
  tasks: [
    { id: 2, order: 2, numValues: 5, requiresJustification: true, minWordCount: 3 },
    { id: 1, order: 1, numValues: 5, requiresJustification: false },
    { id: 3, order: 3, numValues: 5, requiresJustification: true }
  ],
  responses: [{ taskId: 1, selection: 4, justification: '' }]
};

test('keeps only the drafts that differ from the stored answers', () => {
  assert.deepEqual(keepUnsavedDrafts(PHASE, {
    1: { value: 4 },
    2: { justification: '   ' },
    3: { value: 2 },
    99: { value: 1 }
  }), { 3: { value: 2 } });
});

test('lists unsent answers in task order, with what the server would refuse', () => {
  assert.deepEqual(unsentDrafts(PHASE, {
    1: { value: 5 },
    2: { value: 3, justification: ' dos palabras ' },
    3: { value: 2, justification: 'Porque es justo' }
  }), [
    { taskId: 1, answer: { value: 5, justification: '' }, problem: null },
    { taskId: 2, answer: { value: 3, justification: 'dos palabras' }, problem: ANSWER_PROBLEMS.JUSTIFICATION_TOO_SHORT },
    { taskId: 3, answer: { value: 2, justification: 'Porque es justo' }, problem: null }
  ]);

  assert.deepEqual(unsentDrafts(PHASE, { 3: { justification: 'Sin valor' } }), [
    { taskId: 3, answer: { value: null, justification: 'Sin valor' }, problem: ANSWER_PROBLEMS.MISSING_VALUE }
  ]);
  assert.deepEqual(unsentDrafts(PHASE, undefined), []);
  assert.deepEqual(unsentDrafts(null, { 1: { value: 2 } }), []);
});

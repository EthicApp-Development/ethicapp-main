import {
  answerProblem,
  effectiveAnswer,
  isEmptyAnswer,
  normalizeAnswer,
  sameAnswer,
  savedAnswersByTaskId
} from './semanticDifferentialAnswer.js';

/**
 * The answers a student has typed but not submitted, kept on the device
 * (epic #1105, #1118) so that a reload does not lose them and a hard
 * deadline can send them.
 *
 * One `localStorage` entry per user, session and phase, under
 * `ethicapp.student.phaseDrafts.v1:<userId>:<sessionId>:<phaseId>`:
 *
 *     { updatedAt, tasks: { [taskId]: { value?, justification? } } }
 *
 * A task keeps only what the student changed: `value` and `justification`
 * are each optional, and the stored answer fills in the rest
 * (semanticDifferentialAnswer.js, `effectiveAnswer`).
 *
 * Growth is bounded: an entry not written for `ttlMs` is dropped, and
 * `prune` keeps the `maxEntries` newest. A draft equal to the stored answer
 * is not kept, so a submitted answer leaves no entry behind.
 *
 * Storage can be missing or refuse access (private windows, blocked site
 * data, quota): every access is wrapped, and the store then keeps nothing
 * while the page still holds the drafts in memory.
 */

// What became of a draft when its phase ran out of time
// (pages/session-detail/deadlineDraftSender.js).
export const DRAFT_OUTCOMES = Object.freeze({
  SENDING: 'sending',
  SENT: 'sent',
  KEPT: 'kept'
});

export const PHASE_DRAFTS_KEY_PREFIX = 'ethicapp.student.phaseDrafts.v1';

export const PHASE_DRAFTS_DEFAULTS = Object.freeze({
  ttlMs: 24 * 60 * 60 * 1000,
  maxEntries: 30
});

function positiveInteger(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isInteger(number) && number > 0
    ? number
    : null;
}

/**
 * @param {{ userId: unknown, sessionId: unknown, phaseId: unknown }} scope
 * @returns {string|null} null when any id is not a positive integer.
 */
export function phaseDraftKey({ userId, sessionId, phaseId } = {}) {
  const ids = [userId, sessionId, phaseId].map(positiveInteger);
  return ids.includes(null) ? null : `${PHASE_DRAFTS_KEY_PREFIX}:${ids.join(':')}`;
}

/** Only well-formed task drafts: positive integer ids, an integer value, a string justification. */
export function sanitizeTaskDrafts(tasks) {
  if (!tasks || typeof tasks !== 'object') {
    return {};
  }

  return Object.entries(tasks).reduce((acc, [taskId, draft]) => {
    const id = positiveInteger(taskId);
    if (id === null || !draft || typeof draft !== 'object') {
      return acc;
    }

    const clean = {};
    if (Number.isInteger(draft.value)) clean.value = draft.value;
    if (typeof draft.justification === 'string') clean.justification = draft.justification;
    if (Object.keys(clean).length > 0) acc[id] = clean;
    return acc;
  }, {});
}

function defaultStorage() {
  return globalThis.localStorage;
}

/**
 * @param {object} [options]
 * @param {() => Storage|undefined} [options.getStorage] - May throw.
 * @param {() => number} [options.now]
 * @param {number} [options.ttlMs]
 * @param {number} [options.maxEntries]
 */
export function createPhaseDraftStore({
  getStorage = defaultStorage,
  now = () => Date.now(),
  ttlMs = PHASE_DRAFTS_DEFAULTS.ttlMs,
  maxEntries = PHASE_DRAFTS_DEFAULTS.maxEntries
} = {}) {
  function storage() {
    try {
      const instance = getStorage();
      return instance && typeof instance.getItem === 'function' ? instance : null;
    } catch {
      return null;
    }
  }

  function readEntry(instance, key) {
    try {
      const raw = instance.getItem(key);
      if (typeof raw !== 'string') return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Number.isFinite(parsed.updatedAt)) return null;
      return { updatedAt: parsed.updatedAt, tasks: sanitizeTaskDrafts(parsed.tasks) };
    } catch {
      return null;
    }
  }

  function removeKey(instance, key) {
    try {
      instance.removeItem(key);
    } catch {
      // Nothing else to do: the entry expires.
    }
  }

  function ownKeys(instance) {
    const keys = [];
    try {
      for (let index = 0; index < instance.length; index += 1) {
        const key = instance.key(index);
        if (typeof key === 'string' && key.startsWith(`${PHASE_DRAFTS_KEY_PREFIX}:`)) keys.push(key);
      }
    } catch {
      return [];
    }
    return keys;
  }

  function isExpired(entry) {
    return now() - entry.updatedAt > ttlMs;
  }

  return {
    /** The phase's task drafts, by task id; empty when there are none or they expired. */
    load(scope) {
      const key = phaseDraftKey(scope);
      const instance = storage();
      if (!key || !instance) return {};

      const entry = readEntry(instance, key);
      if (!entry || isExpired(entry) || Object.keys(entry.tasks).length === 0) {
        if (entry) removeKey(instance, key);
        return {};
      }
      return entry.tasks;
    },

    /**
     * Replaces the phase's task drafts; none removes the entry. An unchanged
     * entry is not written again, so its age counts from the last change.
     */
    save(scope, tasks) {
      const key = phaseDraftKey(scope);
      const instance = storage();
      if (!key || !instance) return;

      const clean = sanitizeTaskDrafts(tasks);
      if (Object.keys(clean).length === 0) {
        removeKey(instance, key);
        return;
      }

      const current = readEntry(instance, key);
      if (current && !isExpired(current) && JSON.stringify(current.tasks) === JSON.stringify(clean)) {
        return;
      }

      try {
        instance.setItem(key, JSON.stringify({ updatedAt: now(), tasks: clean }));
      } catch {
        // Quota or access refused: the page still has the draft in memory.
      }
    },

    /** Drops expired and unreadable entries, then all but the `maxEntries` newest. */
    prune() {
      const instance = storage();
      if (!instance) return;

      const live = [];
      ownKeys(instance).forEach((key) => {
        const entry = readEntry(instance, key);
        if (!entry || isExpired(entry) || Object.keys(entry.tasks).length === 0) {
          removeKey(instance, key);
        } else {
          live.push({ key, updatedAt: entry.updatedAt });
        }
      });

      live
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(Math.max(0, maxEntries))
        .forEach(({ key }) => removeKey(instance, key));
    },

    /** Removes every draft on the device, for every user (on logout). */
    clearAll() {
      const instance = storage();
      if (!instance) return;
      ownKeys(instance).forEach((key) => removeKey(instance, key));
    }
  };
}

/** Removes every draft kept on this device, for every user: the student logs out. */
export function clearPhaseDraftsOnDevice() {
  createPhaseDraftStore().clearAll();
}

function phaseTasks(phase) {
  return Array.isArray(phase?.tasks) ? phase.tasks : [];
}

/**
 * The task drafts worth keeping: those whose answer differs from the stored
 * one. A draft equal to the stored answer, or empty with none stored, is
 * dropped.
 *
 * @param {object} phase - A phase of full_state, with `tasks` and `responses`.
 * @param {object} drafts - Task drafts by task id.
 * @returns {object} Task drafts by task id.
 */
export function keepUnsavedDrafts(phase, drafts) {
  const clean = sanitizeTaskDrafts(drafts);
  const saved = savedAnswersByTaskId(phase);
  const taskIds = new Set(phaseTasks(phase).map((task) => Number(task?.id)));

  return Object.entries(clean).reduce((acc, [taskId, draft]) => {
    // A task the phase no longer lists has nothing to answer.
    if (taskIds.size > 0 && !taskIds.has(Number(taskId))) return acc;

    const stored = saved[taskId];
    const answer = effectiveAnswer(draft, stored);
    const unchanged = stored
      ? sameAnswer(answer, { value: stored.normalizedValue, justification: stored.normalizedJustification })
      : isEmptyAnswer(answer);
    if (!unchanged) acc[taskId] = draft;
    return acc;
  }, {});
}

/**
 * The phase's answers that differ from what the server stored, in task
 * order, each with the answer that would be sent and why the server would
 * refuse it (null when it would accept it).
 *
 * @param {object} phase - A phase of full_state, with `tasks` and `responses`.
 * @param {object} drafts - Task drafts by task id.
 * @returns {Array<{ taskId: number, answer: { value: number|null, justification: string }, problem: string|null }>}
 */
export function unsentDrafts(phase, drafts) {
  const unsaved = keepUnsavedDrafts(phase, drafts);
  const saved = savedAnswersByTaskId(phase);

  return [...phaseTasks(phase)]
    .sort((left, right) => Number(left?.order ?? 0) - Number(right?.order ?? 0))
    .map((task) => ({ task, taskId: Number(task?.id) }))
    .filter(({ taskId }) => Object.hasOwn(unsaved, taskId))
    .map(({ task, taskId }) => {
      const answer = normalizeAnswer(effectiveAnswer(unsaved[taskId], saved[taskId]));
      return { taskId, answer, problem: answerProblem(task, answer) };
    });
}

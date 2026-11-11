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
// What became of the drafts of a phase whose time ran out, kept so the
// phase's tab and the page notice say it after a reload (#1118):
//
//     { updatedAt, tasks: { [taskId]: { status, reason } }, final, dismissed }
//
// `status` is "sent" or "kept"; `final` says the phase's time ran out (the
// 00:00 or transition trigger is done); `dismissed` that the student closed
// the page notice.
export const DRAFT_OUTCOMES_KEY_PREFIX = 'ethicapp.student.phaseDraftOutcomes.v1';

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

function phaseEntryKey(prefix, { userId, sessionId, phaseId } = {}) {
  const ids = [userId, sessionId, phaseId].map(positiveInteger);
  return ids.includes(null) ? null : `${prefix}:${ids.join(':')}`;
}

/**
 * @param {{ userId: unknown, sessionId: unknown, phaseId: unknown }} scope
 * @returns {string|null} null when any id is not a positive integer.
 */
export function phaseDraftKey(scope) {
  return phaseEntryKey(PHASE_DRAFTS_KEY_PREFIX, scope);
}

export function draftOutcomeKey(scope) {
  return phaseEntryKey(DRAFT_OUTCOMES_KEY_PREFIX, scope);
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

/** Only settled outcomes ("sent" or "kept") of positive integer task ids. */
export function sanitizeOutcomes(tasks) {
  if (!tasks || typeof tasks !== 'object') {
    return {};
  }

  return Object.entries(tasks).reduce((acc, [taskId, outcome]) => {
    const id = positiveInteger(taskId);
    const status = outcome?.status;
    if (id === null || (status !== DRAFT_OUTCOMES.SENT && status !== DRAFT_OUTCOMES.KEPT)) {
      return acc;
    }
    acc[id] = { status, reason: typeof outcome.reason === 'string' ? outcome.reason : null };
    return acc;
  }, {});
}

function defaultStorage() {
  return globalThis.localStorage;
}

// One entry per user, session and phase under `prefix`, with the time to
// live, the entry limit and the wrapped storage access both stores share.
// `sanitize` turns what was read into the entry's data, or null when there
// is nothing worth keeping.
function createScopedStore({ prefix, sanitize, getStorage, now, ttlMs, maxEntries }) {
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
      return { updatedAt: parsed.updatedAt, data: sanitize(parsed) };
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
        if (typeof key === 'string' && key.startsWith(`${prefix}:`)) keys.push(key);
      }
    } catch {
      return [];
    }
    return keys;
  }

  function isLive(entry) {
    return Boolean(entry && entry.data && now() - entry.updatedAt <= ttlMs);
  }

  return {
    load(scope) {
      const key = phaseEntryKey(prefix, scope);
      const instance = storage();
      if (!key || !instance) return null;

      const entry = readEntry(instance, key);
      if (!isLive(entry)) {
        if (entry) removeKey(instance, key);
        return null;
      }
      return entry.data;
    },

    save(scope, value) {
      const key = phaseEntryKey(prefix, scope);
      const instance = storage();
      if (!key || !instance) return;

      const data = sanitize(value);
      if (!data) {
        removeKey(instance, key);
        return;
      }

      const current = readEntry(instance, key);
      if (isLive(current) && JSON.stringify(current.data) === JSON.stringify(data)) {
        return;
      }

      try {
        instance.setItem(key, JSON.stringify({ updatedAt: now(), ...data }));
      } catch {
        // Quota or access refused: the page still has it in memory.
      }
    },

    prune() {
      const instance = storage();
      if (!instance) return;

      const live = [];
      ownKeys(instance).forEach((key) => {
        const entry = readEntry(instance, key);
        if (isLive(entry)) {
          live.push({ key, updatedAt: entry.updatedAt });
        } else {
          removeKey(instance, key);
        }
      });

      live
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(Math.max(0, maxEntries))
        .forEach(({ key }) => removeKey(instance, key));
    },

    clearAll() {
      const instance = storage();
      if (!instance) return;
      ownKeys(instance).forEach((key) => removeKey(instance, key));
    }
  };
}

function storeOptions({
  getStorage = defaultStorage,
  now = () => Date.now(),
  ttlMs = PHASE_DRAFTS_DEFAULTS.ttlMs,
  maxEntries = PHASE_DRAFTS_DEFAULTS.maxEntries
} = {}) {
  return { getStorage, now, ttlMs, maxEntries };
}

/**
 * The drafts on the device.
 *
 * - `load(scope)`: the phase's task drafts, by task id; empty when there
 *   are none or they expired;
 * - `save(scope, tasks)`: replaces them; none removes the entry. An
 *   unchanged entry is not written again, so its age counts from the last
 *   change;
 * - `prune()`: drops expired and unreadable entries, then all but the
 *   `maxEntries` newest;
 * - `clearAll()`: removes every draft on the device, for every user.
 *
 * @param {object} [options]
 * @param {() => Storage|undefined} [options.getStorage] - May throw.
 * @param {() => number} [options.now]
 * @param {number} [options.ttlMs]
 * @param {number} [options.maxEntries]
 */
export function createPhaseDraftStore(options) {
  const store = createScopedStore({
    prefix: PHASE_DRAFTS_KEY_PREFIX,
    sanitize: (value) => {
      const tasks = sanitizeTaskDrafts(value?.tasks);
      return Object.keys(tasks).length > 0 ? { tasks } : null;
    },
    ...storeOptions(options)
  });

  return {
    load: (scope) => store.load(scope)?.tasks ?? {},
    save: (scope, tasks) => store.save(scope, { tasks }),
    prune: () => store.prune(),
    clearAll: () => store.clearAll()
  };
}

/**
 * The outcomes of the drafts of each phase whose time ran out, with the
 * same scope, time to live and limits as the drafts.
 *
 * - `load(scope)`: `{ tasks, final, dismissed }` or null;
 * - `save(scope, { tasks, final, dismissed })`: no settled outcome removes
 *   the entry.
 */
export function createDraftOutcomeStore(options) {
  return createScopedStore({
    prefix: DRAFT_OUTCOMES_KEY_PREFIX,
    sanitize: (value) => {
      const tasks = sanitizeOutcomes(value?.tasks);
      return Object.keys(tasks).length > 0
        ? { tasks, final: value?.final === true, dismissed: value?.dismissed === true }
        : null;
    },
    ...storeOptions(options)
  });
}

/** Removes every draft and outcome kept on this device, for every user: the student logs out. */
export function clearPhaseDraftsOnDevice() {
  createPhaseDraftStore().clearAll();
  createDraftOutcomeStore().clearAll();
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

/**
 * The note under a task about its draft (#1118), or null:
 *
 * - "sending": an automatic send is on its way;
 * - "sent": it was sent for the student when time ran out;
 * - "kept": the phase is over and the draft was never stored (incomplete,
 *   refused, or the teacher closed the phase by hand);
 * - "open": time ran out and the draft could not be sent, but the phase
 *   still takes answers (the last phase of a hard-mode activity, which the
 *   teacher finishes by hand).
 *
 * `problem` is the draft's ANSWER_PROBLEMS reason, or null.
 *
 * @param {object} options
 * @param {{ status: string }|undefined} options.outcome - The task's automatic outcome.
 * @param {{ problem: string|null }|undefined} options.unsent - The task's unsent draft (`unsentDrafts`).
 * @param {boolean} options.phaseOver - The phase no longer takes answers.
 * @returns {{ kind: string, problem: string|null }|null}
 */
export function draftNoteFor({ outcome, unsent, phaseOver }) {
  const status = outcome?.status;
  const problem = unsent?.problem ?? null;

  if (status === DRAFT_OUTCOMES.SENDING) return { kind: 'sending', problem: null };
  if (status === DRAFT_OUTCOMES.SENT && (!unsent || phaseOver)) return { kind: 'sent', problem: null };
  if (unsent && phaseOver) return { kind: 'kept', problem };
  if (unsent && status === DRAFT_OUTCOMES.KEPT) return { kind: 'open', problem };
  return null;
}

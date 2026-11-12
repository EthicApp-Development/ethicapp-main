import {
  COMPOSING_KIND,
  COMPOSING_NOTICE_TTL_MS,
  STOPPED_KIND
} from '../../utils/composingSignalContract.js';

/**
 * Who is writing in the group chat the student has open (epic #601, #1007),
 * from the server's `onChatComposing` notices, with no React of its own: the
 * hook (hooks/useComposingNotices.js) feeds it the chat's target, the
 * notices and the transcripts it loads.
 *
 * - A `composing` notice for the target's group and question keeps its
 *   writer for `ttlMs` (COMPOSING_NOTICE_TTL_MS); a newer one extends it.
 *   A `stopped` removes the writer at once.
 * - A notice about the student's own user is ignored: another tab of theirs
 *   receives it, the tab they write in does not.
 * - A message by a writer removes them. The `onChatMessage` event carries no
 *   author, so this is learned from the transcript the chat reloads: the
 *   messages that are new since the previous load remove their authors,
 *   unless a `composing` of theirs arrived after that load was requested.
 *   The first load after a target change only records what is there.
 * - A target change (another group, phase or question, another socket, the
 *   chat closed or no longer accepting messages) forgets every writer.
 * - Writers are kept in the order they started; `onChange` receives them as
 *   `[{ userId, role, name }]` only when that list changes, never when an
 *   expiry is merely extended, so the notice is not announced again.
 *
 * Timers and the clock are injectable for tests.
 */

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function noticeName(name) {
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
}

export function createComposingNotices({
  timers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (id) => clearTimeout(id) },
  now = () => Date.now(),
  ttlMs = COMPOSING_NOTICE_TTL_MS,
  onChange = () => {}
} = {}) {
  // `{ phaseId, groupId, questionId, selfUserId }` while the chat is shown
  // and accepts messages, null otherwise.
  let target = null;
  // userId -> { userId, role, name, expiresAt, updatedAt }, in start order.
  const writers = new Map();
  // Message ids of the last transcript loaded for the target, or null
  // before its first load.
  let knownMessageIds = null;
  let pruneTimer = null;
  let disposed = false;

  function snapshot() {
    return [...writers.values()].map(({ userId, role, name }) => ({ userId, role, name }));
  }

  function changed() {
    onChange(snapshot());
  }

  function clearPruneTimer() {
    if (pruneTimer !== null) timers.clearTimeout(pruneTimer);
    pruneTimer = null;
  }

  function schedulePrune() {
    clearPruneTimer();
    if (writers.size === 0) return;
    const nextExpiry = Math.min(...[...writers.values()].map(({ expiresAt }) => expiresAt));
    pruneTimer = timers.setTimeout(() => {
      pruneTimer = null;
      prune();
    }, Math.max(0, nextExpiry - now()));
  }

  function prune() {
    if (disposed) return;
    const at = now();
    let removed = false;
    for (const [userId, writer] of writers) {
      if (writer.expiresAt <= at) {
        writers.delete(userId);
        removed = true;
      }
    }
    schedulePrune();
    if (removed) changed();
  }

  function forgetAll() {
    clearPruneTimer();
    knownMessageIds = null;
    if (writers.size === 0) return;
    writers.clear();
    changed();
  }

  return {
    /**
     * The chat's target, on every render. Any change forgets every writer.
     * @param {object} options
     * @param {number} options.phaseId
     * @param {number} options.groupId
     * @param {number} options.questionId
     * @param {number} options.selfUserId - The student's own user.
     * @param {boolean} options.enabled - The chat is shown, accepts
     *     messages and has a connected socket.
     */
    update({ phaseId, groupId, questionId, selfUserId, enabled = false } = {}) {
      if (disposed) return;
      const next = {
        phaseId: positiveInteger(phaseId),
        groupId: positiveInteger(groupId),
        questionId: positiveInteger(questionId),
        selfUserId: positiveInteger(selfUserId)
      };
      const usable = enabled && next.groupId && next.questionId ? next : null;
      const same = (usable === null && target === null) || (usable && target
        && usable.phaseId === target.phaseId
        && usable.groupId === target.groupId
        && usable.questionId === target.questionId
        && usable.selfUserId === target.selfUserId);
      if (same) return;
      target = usable;
      forgetAll();
    },

    /** Forgets every writer, as after a reconnect. */
    reset() {
      if (disposed) return;
      forgetAll();
    },

    /**
     * An `onChatComposing` notice: `{ groupId, questionId, userId, role,
     * name, kind }`. Notices for another chat, about the student, or
     * malformed, are ignored.
     */
    receive(notice) {
      if (disposed || !target || !notice || typeof notice !== 'object') return;
      const userId = positiveInteger(notice.userId);
      if (!userId || userId === target.selfUserId) return;
      if (positiveInteger(notice.groupId) !== target.groupId) return;
      if (positiveInteger(notice.questionId) !== target.questionId) return;

      if (notice.kind === STOPPED_KIND) {
        if (writers.delete(userId)) {
          schedulePrune();
          changed();
        }
        return;
      }
      if (notice.kind !== COMPOSING_KIND) return;

      const at = now();
      const role = notice.role === 'P' ? 'P' : 'A';
      const name = noticeName(notice.name);
      const previous = writers.get(userId);
      writers.set(userId, { userId, role, name, expiresAt: at + ttlMs, updatedAt: at });
      schedulePrune();
      if (!previous || previous.role !== role || previous.name !== name) changed();
    },

    /**
     * A transcript was loaded. One of another group or question, such as a
     * load that finished after the target changed, is ignored.
     * @param {Array<{ id: number, authorId: number|null }>} messages
     * @param {object} load
     * @param {number} load.groupId
     * @param {number} load.questionId
     * @param {number} load.requestedAt - `now()` when the load was requested.
     */
    transcriptLoaded(messages, { groupId, questionId, requestedAt } = {}) {
      if (disposed || !target || !Array.isArray(messages)) return;
      if (positiveInteger(groupId) !== target.groupId || positiveInteger(questionId) !== target.questionId) return;
      const ids = new Set();
      const newAuthors = new Set();
      for (const message of messages) {
        // A message without an id cannot be told apart from the last load.
        const id = positiveInteger(message?.id);
        if (!id) continue;
        ids.add(id);
        if (knownMessageIds && !knownMessageIds.has(id)) {
          const authorId = positiveInteger(message?.authorId);
          if (authorId) newAuthors.add(authorId);
        }
      }
      knownMessageIds = ids;

      let removed = false;
      for (const authorId of newAuthors) {
        const writer = writers.get(authorId);
        if (writer && writer.updatedAt <= requestedAt) {
          writers.delete(authorId);
          removed = true;
        }
      }
      if (removed) {
        schedulePrune();
        changed();
      }
    },

    /** The writers now, in the order they started. */
    writers: snapshot,

    /** The clock the transcript loads are timed with. */
    now: () => now(),

    /** Cancels the expiry timer; nothing is reported afterwards. */
    dispose() {
      if (disposed) return;
      disposed = true;
      clearPruneTimer();
      writers.clear();
      target = null;
    }
  };
}

import { DRAFT_OUTCOMES, sanitizeOutcomes } from '../../utils/phaseDrafts.js';

export { DRAFT_OUTCOMES };

/**
 * Sends a student's unsent answers when a hard-mode phase runs out of time
 * (epic #1105, #1118), with no React and no socket of its own: the hook
 * (hooks/useDeadlineDraftSender.js) feeds it the phase clock's snapshots
 * (phaseClockTracker.js) and the `onPhaseTransition` events, and shows what
 * it reports.
 *
 * When it sends, always to the phase whose time ran out:
 *
 * - `beforeDeadline`: `leadMs` before the deadline of a hard-mode phase,
 *   while the phase is still current;
 * - `deadline`: at 00:00. On the last phase of a hard-mode activity, which
 *   stays current until the teacher finishes the activity, this is the one
 *   that matters; on the others it covers a missed transition event;
 * - `transition`: on `onPhaseTransition` with reason "deadline", addressed
 *   to the phase before the new one, inside the server's grace window for
 *   answers to the previous phase (15 s, #1114).
 *
 * Each trigger sends the drafts that differ from the stored answer and that
 * the server would accept (`collectUnsent`). It never sends in soft mode, in
 * mode "none", for a phase without a deadline, or after a teacher's advance
 * (any other reason), which the server refuses. A page that starts watching
 * a deadline already passed (a reload after 00:00) sends nothing for it.
 *
 * No answer is sent twice: a task with a send in flight (automatic or the
 * student's own, `trackManual`) is skipped, and so is an answer already
 * sent with the same content while the page has not reloaded the stored
 * answers yet. A failed send is tried again only by a later trigger of
 * the same phase (a network failure before the deadline, sent again at
 * 00:00), never in a loop; after the transition nothing is left to try.
 *
 * Timers and the clock are injectable for tests.
 */

export const DEADLINE_DRAFT_SENDER_DEFAULTS = Object.freeze({
  leadMs: 10000,
  // A deadline read again moves by a few milliseconds with the server
  // offset; one that moves later by more than this was extended.
  extensionToleranceMs: 2000
});

export const DRAFT_SEND_TRIGGERS = Object.freeze({
  BEFORE_DEADLINE: 'beforeDeadline',
  DEADLINE: 'deadline',
  TRANSITION: 'transition',
  // Not a send: the student's own submit removed an outcome.
  MANUAL: 'manual'
});

// The reason of a kept draft whose send failed; a draft the server would
// refuse is kept with its ANSWER_PROBLEMS reason instead.
export const SEND_FAILED = 'sendFailed';

const DEADLINE_TRANSITION_REASON = 'deadline';

function positiveInteger(value) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isInteger(number) && number > 0 ? number : null;
}

function fingerprint(answer) {
  return JSON.stringify([answer?.value ?? null, answer?.justification ?? '']);
}

/**
 * @param {object} options
 * @param {(phaseId: number) => Array<{ taskId: number, answer: { value: number|null, justification: string }, problem: string|null }>} options.collectUnsent
 *     The phase's answers that differ from the stored ones (phaseDrafts.js, `unsentDrafts`).
 * @param {(payload: { phaseId: number, questionId: number, value: number, justification: string }) => Promise<unknown>} options.submit
 *     POST /activities/:id/response; rejects when the server refuses.
 * @param {(sent: { phaseId: number, taskIds: number[] }) => Promise<unknown>|void} [options.afterSent]
 *     After a trigger sent at least one answer: reload the stored answers.
 * @param {(report: { phaseId: number, outcomes: object, final: boolean, trigger: string }) => void} [options.onOutcome]
 *     Every automatic outcome of the phase so far, by task id
 *     (`{ status, reason }`, DRAFT_OUTCOMES): when a trigger starts sending,
 *     once it is done, and when the student's own submit replaces one.
 *     `final` is true when the deadline and transition triggers are done.
 *     Only those record a draft as kept: before the deadline the student
 *     may still finish it.
 * @param {(phaseId: number) => object} [options.loadOutcomes]
 *     The outcomes the phase already had, by task id (kept on the device
 *     across reloads, phaseDrafts.js `createDraftOutcomeStore`).
 * @param {(error: unknown) => void} [options.onError]
 */
export function createDeadlineDraftSender({
  collectUnsent,
  submit,
  afterSent = () => {},
  onOutcome = () => {},
  loadOutcomes = () => ({}),
  onError = () => {},
  timers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (id) => clearTimeout(id) },
  now = () => Date.now(),
  options = {}
}) {
  const { leadMs, extensionToleranceMs } = { ...DEADLINE_DRAFT_SENDER_DEFAULTS, ...options };

  // The hard deadline being watched: { phaseId, deadlineAt }.
  let watched = null;
  let beforeTimer = null;
  let deadlineTimer = null;
  let disposed = false;

  // The deadline each trigger last fired for, by phase.
  const fired = new Map();
  const handledTransitions = new Set();
  // Sends in flight by `${phaseId}:${taskId}`, and the content last sent.
  const inFlight = new Map();
  const sentContent = new Map();
  const pendingByPhase = new Map();
  const outcomesByPhase = new Map();

  function clearTimer(id) {
    if (id !== null) timers.clearTimeout(id);
    return null;
  }

  function unwatch() {
    beforeTimer = clearTimer(beforeTimer);
    deadlineTimer = clearTimer(deadlineTimer);
    watched = null;
  }

  function firedFor(phaseId, trigger, deadlineAt) {
    const last = fired.get(phaseId)?.[trigger];
    return Number.isFinite(last) && deadlineAt <= last + extensionToleranceMs;
  }

  function markFired(phaseId, trigger, deadlineAt) {
    fired.set(phaseId, { ...(fired.get(phaseId) ?? {}), [trigger]: deadlineAt });
  }

  function taskKey(phaseId, taskId) {
    return `${phaseId}:${taskId}`;
  }

  function outcomesFor(phaseId) {
    if (!outcomesByPhase.has(phaseId)) {
      let initial = {};
      try {
        initial = loadOutcomes(phaseId) ?? {};
      } catch (error) {
        onError(error);
      }
      outcomesByPhase.set(phaseId, new Map(
        Object.entries(initial).map(([taskId, outcome]) => [Number(taskId), outcome])
      ));
    }
    return outcomesByPhase.get(phaseId);
  }

  function report(phaseId, final, trigger) {
    onOutcome({
      phaseId,
      outcomes: Object.fromEntries(outcomesFor(phaseId)),
      final,
      trigger
    });
  }

  function track(phaseId, key, promise) {
    inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
    if (!pendingByPhase.has(phaseId)) pendingByPhase.set(phaseId, new Set());
    const pending = pendingByPhase.get(phaseId);
    const tracked = promise.finally(() => {
      const count = (inFlight.get(key) ?? 1) - 1;
      if (count > 0) inFlight.set(key, count);
      else inFlight.delete(key);
      pending.delete(tracked);
    });
    pending.add(tracked);
    return tracked;
  }

  // Before the deadline a failed send is not reported as kept: the student
  // is still at work, and the 00:00 trigger tries again.
  function sendOne(phaseId, taskId, answer, final) {
    const key = taskKey(phaseId, taskId);
    const content = fingerprint(answer);
    const outcomes = outcomesFor(phaseId);
    const previous = outcomes.get(taskId);
    outcomes.set(taskId, { status: DRAFT_OUTCOMES.SENDING, reason: null });
    const request = Promise.resolve()
      .then(() => submit({
        phaseId,
        questionId: taskId,
        value: answer.value,
        justification: answer.justification
      }))
      .then(() => {
        sentContent.set(key, content);
        outcomes.set(taskId, { status: DRAFT_OUTCOMES.SENT, reason: null });
        return true;
      }, (error) => {
        if (final) outcomes.set(taskId, { status: DRAFT_OUTCOMES.KEPT, reason: SEND_FAILED });
        else if (previous) outcomes.set(taskId, previous);
        else outcomes.delete(taskId);
        if (!disposed) onError(error);
        return false;
      });
    return track(phaseId, key, request);
  }

  async function sendPhase(phaseId, trigger) {
    let drafts = [];
    try {
      drafts = collectUnsent(phaseId) ?? [];
    } catch (error) {
      onError(error);
    }

    const final = trigger !== DRAFT_SEND_TRIGGERS.BEFORE_DEADLINE;
    const outcomes = outcomesFor(phaseId);
    const unsentTaskIds = new Set(drafts.map(({ taskId }) => taskId));
    // A draft kept earlier that is no longer unsent (the student submitted
    // it, or undid the change) has nothing left to report.
    [...outcomes.entries()].forEach(([taskId, outcome]) => {
      if (outcome.status === DRAFT_OUTCOMES.KEPT && !unsentTaskIds.has(taskId)) outcomes.delete(taskId);
    });

    const sends = [];
    drafts.forEach(({ taskId, answer, problem }) => {
      const key = taskKey(phaseId, taskId);
      if (inFlight.has(key) || sentContent.get(key) === fingerprint(answer)) return;

      if (problem) {
        // Only once time ran out: before, the student may still finish it.
        if (final) outcomes.set(taskId, { status: DRAFT_OUTCOMES.KEPT, reason: problem });
        return;
      }
      sends.push(sendOne(phaseId, taskId, answer, final).then((ok) => (ok ? taskId : null)));
    });

    // The page says which answers are on their way.
    if (sends.length > 0) report(phaseId, false, trigger);

    const sentTaskIds = (await Promise.all(sends)).filter((taskId) => taskId !== null);
    // Sends started earlier, by another trigger or the student, settle too
    // before the outcome is reported.
    await Promise.allSettled([...(pendingByPhase.get(phaseId) ?? [])]);
    if (disposed) return;

    if (sentTaskIds.length > 0) {
      try {
        await afterSent({ phaseId, taskIds: sentTaskIds });
      } catch (error) {
        onError(error);
      }
      if (disposed) return;
    }

    report(phaseId, final, trigger);
  }

  function fire(trigger) {
    if (disposed || !watched) return Promise.resolve();
    const { phaseId, deadlineAt } = watched;
    if (firedFor(phaseId, trigger, deadlineAt)) return Promise.resolve();
    markFired(phaseId, trigger, deadlineAt);
    return sendPhase(phaseId, trigger);
  }

  function watch(phaseId, deadlineAt) {
    unwatch();
    watched = { phaseId, deadlineAt };
    const untilDeadline = deadlineAt - now();

    if (untilDeadline <= 0) {
      // The page saw this deadline only after it passed (a reload after
      // 00:00): what was typed before is not sent for the student.
      markFired(phaseId, DRAFT_SEND_TRIGGERS.BEFORE_DEADLINE, deadlineAt);
      markFired(phaseId, DRAFT_SEND_TRIGGERS.DEADLINE, deadlineAt);
      return;
    }

    if (!firedFor(phaseId, DRAFT_SEND_TRIGGERS.BEFORE_DEADLINE, deadlineAt)) {
      beforeTimer = timers.setTimeout(() => {
        beforeTimer = null;
        fire(DRAFT_SEND_TRIGGERS.BEFORE_DEADLINE);
      }, Math.max(0, untilDeadline - leadMs));
    }
    if (!firedFor(phaseId, DRAFT_SEND_TRIGGERS.DEADLINE, deadlineAt)) {
      deadlineTimer = timers.setTimeout(() => {
        deadlineTimer = null;
        fire(DRAFT_SEND_TRIGGERS.DEADLINE);
      }, untilDeadline);
    }
  }

  return {
    /**
     * A phase clock snapshot (HIDDEN_TIMER_SNAPSHOT in phaseClockTracker.js
     * documents it). Only an enforced deadline is watched.
     */
    timerChanged(snapshot) {
      if (disposed) return;
      const phaseId = positiveInteger(snapshot?.phaseId);
      const deadlineAt = Number.isFinite(snapshot?.deadlineAt) ? snapshot.deadlineAt : null;

      if (snapshot?.hardDeadline !== true || phaseId === null || deadlineAt === null) {
        unwatch();
        return;
      }

      const sameDeadline = watched
        && watched.phaseId === phaseId
        && Math.abs(watched.deadlineAt - deadlineAt) <= extensionToleranceMs;
      if (!sameDeadline) watch(phaseId, deadlineAt);

      // A timer that a background tab held back: the snapshot already says 00:00.
      if (snapshot.deadlineReached === true) fire(DRAFT_SEND_TRIGGERS.DEADLINE);
    },

    /**
     * An `onPhaseTransition` event `{ sessionId, phaseId, phaseNumber, reason }`,
     * with the id of the phase before the new one (the one the server lets
     * answers reach for a while), or null when the page does not know it.
     */
    phaseTransition(payload, previousPhaseId) {
      if (disposed) return Promise.resolve();
      const phaseId = positiveInteger(payload?.phaseId);

      // The watched deadline belongs to a phase that is over.
      if (watched && watched.phaseId !== phaseId) unwatch();

      if (payload?.reason !== DEADLINE_TRANSITION_REASON) return Promise.resolve();
      if (phaseId !== null) {
        if (handledTransitions.has(phaseId)) return Promise.resolve();
        handledTransitions.add(phaseId);
      }

      const previous = positiveInteger(previousPhaseId);
      if (previous === null || previous === phaseId) return Promise.resolve();
      return sendPhase(previous, DRAFT_SEND_TRIGGERS.TRANSITION);
    },

    /**
     * The student's own submit of `payload` `{ phaseId, questionId, value,
     * justification }`, made by `send`, which resolves to `{ ok }`. While it
     * runs no automatic send of that task starts; once accepted, the same
     * content is not sent again.
     */
    trackManual(payload, send) {
      const phaseId = positiveInteger(payload?.phaseId);
      const taskId = positiveInteger(payload?.questionId);
      const request = Promise.resolve().then(send);
      if (phaseId === null || taskId === null) return request;

      const key = taskKey(phaseId, taskId);
      const content = fingerprint({ value: payload.value, justification: payload.justification ?? '' });
      return track(phaseId, key, request.then((result) => {
        if (result?.ok) {
          sentContent.set(key, content);
          // Submitted by the student, not for them: nothing left to report.
          if (outcomesFor(phaseId).delete(taskId) && !disposed) report(phaseId, false, DRAFT_SEND_TRIGGERS.MANUAL);
        }
        return result;
      }));
    },

    dispose() {
      disposed = true;
      unwatch();
    }
  };
}

/** The phase the server lets answers reach after an advance to `phaseNumber`: the highest-numbered one before it. */
export function previousPhaseId(phases, phaseNumber) {
  const number = Number(phaseNumber);
  if (!Array.isArray(phases) || !Number.isInteger(number) || number <= 1) return null;

  const previous = phases
    .filter((phase) => Number.isInteger(Number(phase?.number)) && Number(phase.number) < number)
    .sort((left, right) => Number(right.number) - Number(left.number))[0];
  const id = Number(previous?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The page notice for a phase's outcomes once its time ran out, or null when nothing was pending. */
export function deadlineNoticeFor(phaseId, phaseNumber, outcomes) {
  const statuses = Object.values(outcomes ?? {}).map((outcome) => outcome?.status);
  const sent = statuses.filter((status) => status === DRAFT_OUTCOMES.SENT).length;
  const kept = statuses.filter((status) => status === DRAFT_OUTCOMES.KEPT).length;
  return sent + kept > 0 ? { phaseId, phaseNumber, sent, kept } : null;
}

function sameCounts(left, right) {
  const a = deadlineNoticeFor(0, null, left);
  const b = deadlineNoticeFor(0, null, right);
  return (a?.sent ?? 0) === (b?.sent ?? 0) && (a?.kept ?? 0) === (b?.kept ?? 0);
}

/**
 * What the page keeps of a phase after a report of the sender: the
 * outcomes, `final` once the phase's time ran out, and `dismissed` while
 * the student has closed a notice that still says the same.
 *
 * @param {{ tasks: object, final: boolean, dismissed: boolean }|null} previous
 * @param {{ outcomes: object, final: boolean }} report
 */
export function nextOutcomeRecord(previous, report) {
  const tasks = { ...(report?.outcomes ?? {}) };
  return {
    tasks,
    final: previous?.final === true || report?.final === true,
    dismissed: previous?.dismissed === true && sameCounts(previous.tasks, tasks)
  };
}

/** A record as kept on the device: settled outcomes only. */
export function storedOutcomeRecord(record) {
  return { ...record, tasks: sanitizeOutcomes(record?.tasks) };
}

/**
 * The page notice: the latest phase, by number, whose time ran out with
 * answers sent or kept, unless the student closed it.
 *
 * @param {object} recordsByPhaseId - nextOutcomeRecord()s by phase id.
 * @param {Array<{ id: number, number: number }>} phases
 * @returns {{ phaseId: number, phaseNumber: number|null, sent: number, kept: number }|null}
 */
export function noticeFromRecords(recordsByPhaseId, phases) {
  const numberOf = (phaseId) => {
    const phase = Array.isArray(phases) ? phases.find((candidate) => Number(candidate?.id) === Number(phaseId)) : null;
    const number = Number(phase?.number);
    return Number.isInteger(number) && number > 0 ? number : null;
  };

  return Object.entries(recordsByPhaseId ?? {})
    .filter(([, record]) => record?.final === true && record.dismissed !== true)
    .map(([phaseId, record]) => deadlineNoticeFor(Number(phaseId), numberOf(phaseId), record.tasks))
    .filter(Boolean)
    .sort((left, right) => (right.phaseNumber ?? 0) - (left.phaseNumber ?? 0))[0] ?? null;
}

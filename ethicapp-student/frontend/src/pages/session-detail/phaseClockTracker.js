import {
  TIME_MODES,
  TIMER_STATES,
  computeOffset,
  crossedMilestone,
  formatRemaining,
  isStaleClock,
  isTimedClock,
  msUntilNextSecond,
  normalizeClock,
  remainingMs,
  remainingSeconds,
  timerState,
  wasExtended
} from '../../utils/phaseClock.js';

/**
 * Follows the phase clock of one activity for the student app (epic #1105,
 * #1117), with no React and no socket of its own: the hook
 * (hooks/useActivityPhaseTimer.js) feeds it the clock reads, the socket
 * events and the page's visibility, and renders its snapshots.
 *
 * - The clock is read when the tracker starts, after a reconnect, when the
 *   page becomes visible again and when the page sees a current phase other
 *   than the clock's (its polling fallback, #626, found a phase change the
 *   socket missed). Reads never overlap: one requested while another runs
 *   runs once after it.
 * - `onPhaseClock` replaces the clock. A clock read before the one shown
 *   (by the server's time), or for an earlier phase, is ignored.
 * - `onPhaseTransition` to a later phase hides the old phase's clock at
 *   once, and waits for the `onPhaseClock` that follows it; when none comes
 *   within `transitionFallbackMs`, the clock is read.
 * - The count ticks with a timeout aligned to the next change of the shown
 *   second, and is computed from the server's time each time, never
 *   accumulated: a tick that comes late after a sleep shows the right time.
 * - At 00:00 the clock is read again after `timeUpRecheckMs`, in case time
 *   was added while the socket was down; while a hard phase waits for the
 *   server to start the next one, again every `advancingRecheckMs`.
 *
 * Snapshots carry an `announcement` `{ kind, id, remainingSeconds }` for a
 * polite live region, renewed only at the moments worth saying aloud:
 * "fiveMinutes", "oneMinute", "timeUp", "advancing" (hard mode at 00:00 with
 * a next phase), "newPhase" and "extended". The first clock read says
 * nothing.
 *
 * Timers and the clock are injectable for tests.
 */

export const PHASE_CLOCK_TRACKER_DEFAULTS = Object.freeze({
  transitionFallbackMs: 3000,
  timeUpRecheckMs: 3000,
  advancingRecheckMs: 10000,
  extendedNoticeMs: 10000
});

/**
 * What the student app needs to show the clock, and what other features
 * can rely on (#1118 sends unsent answers before a hard deadline):
 *
 * - `state`: one of TIMER_STATES; "hidden" when there is nothing to show;
 * - `display`: the time left as mm:ss or h:mm:ss, never negative;
 * - `remainingSeconds`: the whole seconds shown, or null without a clock;
 * - `timeMode`, `phaseId`, `phaseNumber`, `isLastPhase`: from the clock;
 * - `deadlineAt`: the deadline in the device's time (`Date.now()` terms),
 *   corrected by the server offset, or null without a deadline;
 * - `deadlineReached`: a timed phase at 00:00;
 * - `hardDeadline`: the phase's deadline is enforced (hard mode, timed);
 * - `extended`: time was just added to the phase (shown for a while);
 * - `announcement`: `{ kind, id, remainingSeconds }` or null, the latest
 *   thing to say aloud, with the time left when it was said.
 */
export const HIDDEN_TIMER_SNAPSHOT = Object.freeze({
  state: TIMER_STATES.HIDDEN,
  display: '',
  remainingSeconds: null,
  timeMode: null,
  phaseId: null,
  phaseNumber: null,
  isLastPhase: null,
  deadlineAt: null,
  deadlineReached: false,
  hardDeadline: false,
  extended: false,
  announcement: null
});

const SNAPSHOT_KEYS = Object.keys(HIDDEN_TIMER_SNAPSHOT);

function sameSnapshot(a, b) {
  return SNAPSHOT_KEYS.every((key) => (
    key === 'announcement' ? (a.announcement?.id ?? null) === (b.announcement?.id ?? null) : a[key] === b[key]
  ));
}

function positiveInteger(value) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * @param {object} options
 * @param {number} options.sessionId
 * @param {(sessionId: number) => Promise<unknown>} options.fetchClock - Reads
 *     GET /activities/:id/clock.
 * @param {(snapshot: object) => void} [options.onChange]
 * @param {(error: unknown) => void} [options.onError]
 */
export function createPhaseClockTracker({
  sessionId,
  fetchClock,
  onChange = () => {},
  onError = () => {},
  timers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (id) => clearTimeout(id) },
  now = () => Date.now(),
  options = {}
}) {
  const {
    transitionFallbackMs, timeUpRecheckMs, advancingRecheckMs, extendedNoticeMs
  } = { ...PHASE_CLOCK_TRACKER_DEFAULTS, ...options };
  const activeSessionId = Number(sessionId);

  let clock = null;
  let offset = 0;
  let hasClock = false;
  // The latest phase a transition announced: clocks for earlier ones are old.
  let minPhaseNumber = 0;
  // The shown seconds at the last update, for the phase they belong to.
  let trackedPhaseId = null;
  let lastSeconds = null;
  // The deadline whose 00:00 already asked for a recheck.
  let timeUpCheckedFor = null;
  let extendedUntil = 0;
  let announcement = null;
  let announcementSeq = 0;
  let snapshot = HIDDEN_TIMER_SNAPSHOT;

  let tickTimer = null;
  let transitionTimer = null;
  let recheckTimer = null;
  let inFlight = false;
  let queued = false;
  let disposed = false;

  function clearTimer(id) {
    if (id !== null) timers.clearTimeout(id);
    return null;
  }

  // The time left is frozen in the announcement, so its text does not
  // change with every tick.
  function announce(kind) {
    announcementSeq += 1;
    announcement = {
      kind,
      id: announcementSeq,
      remainingSeconds: remainingSeconds(remainingMs(clock, offset, now()))
    };
  }

  function buildSnapshot(state, seconds) {
    if (state === TIMER_STATES.HIDDEN) {
      return { ...HIDDEN_TIMER_SNAPSHOT, announcement };
    }
    return {
      state,
      display: formatRemaining(seconds),
      remainingSeconds: seconds,
      timeMode: clock.timeMode,
      phaseId: clock.phaseId,
      phaseNumber: clock.phaseNumber,
      isLastPhase: clock.isLastPhase,
      deadlineAt: clock.endsAtMs - offset,
      deadlineReached: seconds === 0,
      hardDeadline: clock.timeMode === TIME_MODES.HARD,
      extended: now() < extendedUntil,
      announcement
    };
  }

  function scheduleRecheck(state) {
    if (recheckTimer !== null) return;

    const deadlineKey = `${clock.phaseId}:${clock.endsAtMs}`;
    let delay = null;
    if (timeUpCheckedFor !== deadlineKey) {
      timeUpCheckedFor = deadlineKey;
      delay = timeUpRecheckMs;
    } else if (state === TIMER_STATES.ADVANCING) {
      delay = advancingRecheckMs;
    }
    if (delay === null) return;

    recheckTimer = timers.setTimeout(() => {
      recheckTimer = null;
      refresh();
    }, delay);
  }

  function update() {
    if (disposed) return;
    tickTimer = clearTimer(tickTimer);

    const milliseconds = remainingMs(clock, offset, now());
    const state = timerState(clock, milliseconds);
    const seconds = state === TIMER_STATES.HIDDEN ? null : remainingSeconds(milliseconds);

    if (state !== TIMER_STATES.HIDDEN) {
      if (trackedPhaseId === clock.phaseId && lastSeconds !== null) {
        const milestone = crossedMilestone(lastSeconds, seconds);
        if (milestone) announce(milestone === 'timeUp' && state === TIMER_STATES.ADVANCING ? 'advancing' : milestone);
      }
      trackedPhaseId = clock.phaseId;
      lastSeconds = seconds;

      if (seconds === 0) scheduleRecheck(state);
    }

    const next = buildSnapshot(state, seconds);
    if (!sameSnapshot(snapshot, next)) {
      snapshot = next;
      onChange(snapshot);
    }

    const delays = [];
    const untilNextSecond = state === TIMER_STATES.HIDDEN ? null : msUntilNextSecond(milliseconds);
    if (untilNextSecond !== null) delays.push(untilNextSecond);
    if (snapshot.extended) delays.push(Math.max(0, extendedUntil - now()) + 1);
    if (delays.length > 0) {
      tickTimer = timers.setTimeout(update, Math.min(...delays));
    }
  }

  function isOlderThanTransition(incoming) {
    if (incoming.finished) return false;
    return incoming.phaseNumber === null ? minPhaseNumber > 0 : incoming.phaseNumber < minPhaseNumber;
  }

  function apply(incoming, localTimes) {
    if (isStaleClock(clock, incoming) || isOlderThanTransition(incoming)) {
      return;
    }

    const previous = clock;
    transitionTimer = clearTimer(transitionTimer);

    clock = incoming;
    offset = computeOffset(incoming.serverNowMs, localTimes);

    if (isTimedClock(incoming)) {
      if (wasExtended(previous, incoming)) {
        extendedUntil = now() + extendedNoticeMs;
        lastSeconds = null;
        recheckTimer = clearTimer(recheckTimer);
        announce('extended');
      } else if (hasClock && incoming.phaseId !== trackedPhaseId) {
        announce('newPhase');
      }
    }
    if (incoming.phaseId !== trackedPhaseId) {
      trackedPhaseId = incoming.phaseId;
      lastSeconds = null;
      extendedUntil = 0;
      recheckTimer = clearTimer(recheckTimer);
    }
    hasClock = true;
    update();
  }

  function refresh() {
    if (disposed) return Promise.resolve();
    if (inFlight) {
      queued = true;
      return Promise.resolve();
    }

    inFlight = true;
    const sentAt = now();
    // The read starts at once; an error it throws is handled as a rejection.
    return new Promise((resolve) => resolve(fetchClock(activeSessionId)))
      .then((raw) => {
        if (disposed) return;
        const incoming = normalizeClock(raw);
        if (incoming && incoming.sessionId === activeSessionId) {
          apply(incoming, { sentAt, receivedAt: now() });
        }
      })
      .catch((error) => {
        if (!disposed) onError(error);
      })
      .finally(() => {
        inFlight = false;
        if (disposed) return;
        if (queued) {
          queued = false;
          return refresh();
        }
        update();
      });
  }

  return {
    /** Reads the clock for the first time. */
    start() {
      return refresh();
    },

    /** An `onPhaseClock` event. */
    handleClock(payload) {
      if (disposed) return;
      const incoming = normalizeClock(payload);
      if (!incoming || incoming.sessionId !== activeSessionId) return;
      apply(incoming, { receivedAt: now() });
    },

    /** An `onPhaseTransition` event: `{ sessionId, phaseId, phaseNumber, reason }`. */
    handlePhaseTransition(payload) {
      if (disposed) return;
      const payloadSessionId = positiveInteger(payload?.sessionId);
      if (payloadSessionId !== null && payloadSessionId !== activeSessionId) return;

      const phaseNumber = positiveInteger(payload?.phaseNumber);
      if (phaseNumber !== null && Number.isInteger(clock?.phaseNumber) && phaseNumber <= clock.phaseNumber) {
        // The clock already describes this phase or a later one.
        return;
      }

      if (phaseNumber !== null) {
        minPhaseNumber = Math.max(minPhaseNumber, phaseNumber);
        if (clock && !clock.finished) {
          // The old phase's count is over: nothing is shown until the new
          // phase's clock arrives.
          clock = null;
          update();
        }
      }

      transitionTimer = clearTimer(transitionTimer);
      transitionTimer = timers.setTimeout(() => {
        transitionTimer = null;
        refresh();
      }, transitionFallbackMs);
    },

    /** The page became visible: catch up at once, then read the clock. */
    pageVisible() {
      if (disposed) return Promise.resolve();
      update();
      return refresh();
    },

    /** The socket reconnected and rejoined its rooms. */
    reconnected() {
      return refresh();
    },

    /**
     * The page's current phase. A phase other than the clock's means the
     * activity moved on without the clock hearing of it.
     */
    phaseChanged(phaseId) {
      const id = positiveInteger(phaseId);
      if (disposed || id === null) return Promise.resolve();
      if (clock ? clock.phaseId === id : inFlight) return Promise.resolve();
      return refresh();
    },

    snapshot() {
      return snapshot;
    },

    dispose() {
      disposed = true;
      tickTimer = clearTimer(tickTimer);
      transitionTimer = clearTimer(transitionTimer);
      recheckTimer = clearTimer(recheckTimer);
    }
  };
}

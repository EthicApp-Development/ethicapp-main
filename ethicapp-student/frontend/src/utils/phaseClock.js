/**
 * The phase clock in the student app (epic #1105, #1117): pure functions
 * over the clock that `GET /activities/:id/clock` answers and the
 * `onPhaseClock` socket event carries (ethicapp/backend/helpers/phase-clock.js
 * documents its shape and edge cases).
 *
 * The count is always computed from the server's time, never accumulated
 * from ticks: the client stores `offset = serverNow - localNow` when it
 * receives a clock, and the time left at any moment is
 * `endsAt - (Date.now() + offset)`. A tab that comes back from the
 * background, or a phone that wakes up, shows the right time at its first
 * tick.
 *
 * Students never see a negative count: the time left is clamped at zero,
 * and at zero the state says what happens next.
 */

export const TIME_MODES = Object.freeze({
  NONE: 'none',
  SOFT: 'soft',
  HARD: 'hard'
});

export const TIMER_STATES = Object.freeze({
  // No clock: mode "none", a phase without a duration, no phase started
  // yet, a finished activity, or no clock read yet.
  HIDDEN: 'hidden',
  RUNNING: 'running',
  // Less than a minute left (00:59 or less on screen).
  LAST_MINUTE: 'lastMinute',
  // Hard mode at 00:00, with a next phase: the server starts it.
  ADVANCING: 'advancing',
  // Soft mode at 00:00, or hard mode at 00:00 on the last phase: the
  // teacher decides what comes next.
  TIME_UP: 'timeUp'
});

// The milestones a screen reader announces, besides a new phase and added
// time (phaseClockTracker.js).
export const FIVE_MINUTES_SECONDS = 5 * 60;
export const LAST_MINUTE_SECONDS = 60;

const KNOWN_TIME_MODES = new Set(Object.values(TIME_MODES));

function positiveIntegerOrNull(value) {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isInteger(number) && number > 0 ? number : null;
}

function timeOrNull(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * Validates a clock from the API or a socket event, with its times parsed
 * to epoch milliseconds (`endsAtMs`, `serverNowMs`).
 *
 * @param {unknown} raw
 * @returns {object|null} null when it is not a clock.
 */
export function normalizeClock(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const sessionId = positiveIntegerOrNull(raw.sessionId);
  const serverNowMs = timeOrNull(raw.serverNow);
  if (sessionId === null || serverNowMs === null) {
    return null;
  }

  const finished = raw.finished === true;
  const phaseId = finished ? null : positiveIntegerOrNull(raw.phaseId);

  return {
    sessionId,
    timeMode: KNOWN_TIME_MODES.has(raw.timeMode) ? raw.timeMode : TIME_MODES.NONE,
    finished,
    phaseId,
    phaseNumber: phaseId === null ? null : positiveIntegerOrNull(raw.phaseNumber),
    endsAtMs: phaseId === null ? null : timeOrNull(raw.endsAt),
    isLastPhase: phaseId === null ? null : raw.isLastPhase === true,
    serverNowMs
  };
}

/**
 * The difference between the server's clock and the device's. For an HTTP
 * read, the device's time is taken halfway between the request and its
 * answer, which halves the error the network's delay adds.
 *
 * @param {number} serverNowMs
 * @param {{ sentAt?: number, receivedAt: number }} localTimes
 * @returns {number} Milliseconds to add to the device's time.
 */
export function computeOffset(serverNowMs, { sentAt, receivedAt }) {
  const localNow = Number.isFinite(sentAt) && sentAt <= receivedAt
    ? sentAt + (receivedAt - sentAt) / 2
    : receivedAt;
  return serverNowMs - localNow;
}

/**
 * Whether the clock counts down: a timed mode, an activity in progress, a
 * current phase and a deadline.
 */
export function isTimedClock(clock) {
  return Boolean(
    clock
    && clock.timeMode !== TIME_MODES.NONE
    && !clock.finished
    && clock.phaseId !== null
    && Number.isFinite(clock.endsAtMs)
  );
}

/**
 * The time left before the deadline, possibly negative once it passed.
 *
 * @returns {number|null} null for a clock that does not count down.
 */
export function remainingMs(clock, offsetMs, nowMs) {
  if (!isTimedClock(clock)) {
    return null;
  }
  return clock.endsAtMs - (nowMs + offsetMs);
}

/**
 * The whole seconds shown: rounded up, so 00:00 appears exactly at the
 * deadline, and never negative.
 */
export function remainingSeconds(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return 0;
  }
  return Math.ceil(milliseconds / 1000);
}

/**
 * @param {object|null} clock
 * @param {number|null} milliseconds - remainingMs()
 * @returns {string} One of TIMER_STATES.
 */
export function timerState(clock, milliseconds) {
  if (!isTimedClock(clock) || milliseconds === null) {
    return TIMER_STATES.HIDDEN;
  }

  const seconds = remainingSeconds(milliseconds);
  if (seconds === 0) {
    return clock.timeMode === TIME_MODES.HARD && !clock.isLastPhase
      ? TIMER_STATES.ADVANCING
      : TIMER_STATES.TIME_UP;
  }
  return seconds < LAST_MINUTE_SECONDS ? TIMER_STATES.LAST_MINUTE : TIMER_STATES.RUNNING;
}

function twoDigits(value) {
  return String(value).padStart(2, '0');
}

/**
 * mm:ss, or h:mm:ss from one hour on. Phases last up to 180 minutes.
 *
 * @param {number} seconds - remainingSeconds()
 */
export function formatRemaining(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;

  return hours > 0
    ? `${hours}:${twoDigits(minutes)}:${twoDigits(rest)}`
    : `${twoDigits(minutes)}:${twoDigits(rest)}`;
}

/**
 * The time left in whole hours, minutes and seconds, for the text a screen
 * reader reads in place of the digits.
 */
export function remainingParts(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60
  };
}

/**
 * How long until the shown second changes, for a timeout aligned to it
 * rather than a drifting interval. A few milliseconds are added so the
 * timeout lands just after the change.
 *
 * @param {number|null} milliseconds - remainingMs()
 * @returns {number|null} null when the count is at zero.
 */
export function msUntilNextSecond(milliseconds, marginMs = 5) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return null;
  }
  const intoSecond = milliseconds % 1000;
  return (intoSecond === 0 ? 1000 : intoSecond) + marginMs;
}

/**
 * Whether `incoming` is older than `current` and must be ignored: answers
 * and events can arrive out of order, and the server's time says which was
 * read last. A clock for an earlier phase is also older.
 */
export function isStaleClock(current, incoming) {
  if (!current) {
    return false;
  }
  if (incoming.serverNowMs < current.serverNowMs) {
    return true;
  }
  return current.phaseNumber !== null
    && incoming.phaseNumber !== null
    && incoming.phaseNumber < current.phaseNumber;
}

/**
 * Whether `next` moved the deadline of the same phase later, as "+1 min"
 * does (#1112).
 */
export function wasExtended(previous, next) {
  return Boolean(
    isTimedClock(previous)
    && isTimedClock(next)
    && previous.phaseId === next.phaseId
    && next.endsAtMs - previous.endsAtMs >= 1000
  );
}

/**
 * The milestone crossed when the shown seconds go from `previousSeconds` to
 * `seconds` within one phase: "timeUp", "oneMinute", "fiveMinutes" or null.
 * After a long sleep several may be crossed at once; only the latest one is
 * worth saying.
 */
export function crossedMilestone(previousSeconds, seconds) {
  if (!Number.isFinite(previousSeconds) || !Number.isFinite(seconds) || seconds >= previousSeconds) {
    return null;
  }
  if (seconds === 0) {
    return 'timeUp';
  }
  if (previousSeconds >= LAST_MINUTE_SECONDS && seconds < LAST_MINUTE_SECONDS) {
    return 'oneMinute';
  }
  if (previousSeconds > FIVE_MINUTES_SECONDS && seconds <= FIVE_MINUTES_SECONDS) {
    return 'fiveMinutes';
  }
  return null;
}

/**
 * The time left in words, for screen readers: "12 minutos y 34 segundos",
 * or hours and minutes from one hour on. `roundToMinutes` rounds a minute or
 * more to whole minutes, for announcements made a moment after a phase
 * started or time was added.
 *
 * @param {number} seconds
 * @param {(key: string) => string} t - Reads the `phaseTimer` unit keys.
 * @param {{ roundToMinutes?: boolean }} [options]
 */
export function spokenRemaining(seconds, t, { roundToMinutes = false } = {}) {
  let total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  if (roundToMinutes && total >= 60) {
    total = Math.round(total / 60) * 60;
  }

  const parts = remainingParts(total);
  const unit = (value, one, many) => `${value} ${t(value === 1 ? one : many)}`;
  const words = [];

  if (parts.hours > 0) {
    words.push(unit(parts.hours, 'phaseTimer.hour', 'phaseTimer.hours'));
    if (parts.minutes > 0) words.push(unit(parts.minutes, 'phaseTimer.minute', 'phaseTimer.minutes'));
  } else {
    if (parts.minutes > 0) words.push(unit(parts.minutes, 'phaseTimer.minute', 'phaseTimer.minutes'));
    if (parts.seconds > 0 || words.length === 0) {
      words.push(unit(parts.seconds, 'phaseTimer.second', 'phaseTimer.seconds'));
    }
  }

  return words.join(` ${t('phaseTimer.and')} `);
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
  spokenRemaining,
  timerState,
  wasExtended
} from '../phaseClock.js';

const T0 = Date.parse('2026-11-11T15:00:00.000Z');

function rawClock(overrides = {}) {
  return {
    sessionId: 7,
    timeMode: 'soft',
    finished: false,
    phaseId: 31,
    phaseNumber: 2,
    startedAt: '2026-11-11T14:50:00.000Z',
    endsAt: '2026-11-11T15:10:00.000Z',
    isLastPhase: false,
    serverNow: '2026-11-11T15:00:00.000Z',
    ...overrides
  };
}

function clock(overrides = {}) {
  return normalizeClock(rawClock(overrides));
}

test('normalizeClock parses the times and keeps the fields', () => {
  assert.deepEqual(clock(), {
    sessionId: 7,
    timeMode: 'soft',
    finished: false,
    phaseId: 31,
    phaseNumber: 2,
    endsAtMs: T0 + 10 * 60 * 1000,
    isLastPhase: false,
    serverNowMs: T0
  });
});

test('normalizeClock rejects what is not a clock', () => {
  assert.equal(normalizeClock(null), null);
  assert.equal(normalizeClock('clock'), null);
  assert.equal(normalizeClock(rawClock({ sessionId: 0 })), null);
  assert.equal(normalizeClock(rawClock({ serverNow: 'yesterday' })), null);
  assert.equal(normalizeClock(rawClock({ serverNow: undefined })), null);
});

test('normalizeClock drops the phase of a finished activity and unknown modes', () => {
  const finished = clock({ finished: true });
  assert.equal(finished.phaseId, null);
  assert.equal(finished.endsAtMs, null);
  assert.equal(finished.isLastPhase, null);
  assert.equal(clock({ timeMode: 'turbo' }).timeMode, 'none');
});

test('isTimedClock needs a timed mode, a phase and a deadline', () => {
  assert.equal(isTimedClock(clock()), true);
  assert.equal(isTimedClock(clock({ timeMode: 'hard' })), true);
  assert.equal(isTimedClock(clock({ timeMode: 'none' })), false);
  assert.equal(isTimedClock(clock({ endsAt: null })), false);
  assert.equal(isTimedClock(clock({ phaseId: null, phaseNumber: null, endsAt: null })), false);
  assert.equal(isTimedClock(clock({ finished: true })), false);
  assert.equal(isTimedClock(null), false);
});

test('computeOffset takes the device time halfway through an HTTP read', () => {
  // The device is 30 s behind the server; the read took 400 ms.
  assert.equal(computeOffset(T0, { sentAt: T0 - 30000 - 200, receivedAt: T0 - 30000 + 200 }), 30000);
  // A socket event has only its receipt time.
  assert.equal(computeOffset(T0, { receivedAt: T0 + 5000 }), -5000);
  // A device clock that moved back during the read is not averaged.
  assert.equal(computeOffset(T0, { sentAt: T0 + 1000, receivedAt: T0 }), 0);
});

test('remainingMs counts from the server time, whatever the device clock says', () => {
  const offset = computeOffset(T0, { receivedAt: T0 - 60000 });
  assert.equal(remainingMs(clock(), offset, T0 - 60000), 10 * 60 * 1000);
  assert.equal(remainingMs(clock(), offset, T0 - 60000 + 61000), 9 * 60 * 1000 - 1000);
  assert.equal(remainingMs(clock({ timeMode: 'none' }), offset, T0), null);
});

test('remainingSeconds rounds up and never goes below zero', () => {
  assert.equal(remainingSeconds(12340), 13);
  assert.equal(remainingSeconds(12000), 12);
  assert.equal(remainingSeconds(1), 1);
  assert.equal(remainingSeconds(0), 0);
  assert.equal(remainingSeconds(-135000), 0);
  assert.equal(remainingSeconds(null), 0);
});

test('timerState: running, last minute, then time up by mode', () => {
  assert.equal(timerState(clock(), 61000), TIMER_STATES.RUNNING);
  assert.equal(timerState(clock(), 60000), TIMER_STATES.RUNNING);
  assert.equal(timerState(clock(), 59000), TIMER_STATES.LAST_MINUTE);
  assert.equal(timerState(clock(), 1), TIMER_STATES.LAST_MINUTE);
  assert.equal(timerState(clock(), 0), TIMER_STATES.TIME_UP);
  assert.equal(timerState(clock(), -5000), TIMER_STATES.TIME_UP);
  assert.equal(timerState(clock({ timeMode: 'hard' }), -5000), TIMER_STATES.ADVANCING);
  assert.equal(timerState(clock({ timeMode: 'hard', isLastPhase: true }), -5000), TIMER_STATES.TIME_UP);
});

test('timerState is hidden without a countdown', () => {
  assert.equal(timerState(null, null), TIMER_STATES.HIDDEN);
  assert.equal(timerState(clock({ timeMode: 'none' }), null), TIMER_STATES.HIDDEN);
  assert.equal(timerState(clock({ endsAt: null }), null), TIMER_STATES.HIDDEN);
  assert.equal(timerState(clock({ finished: true }), null), TIMER_STATES.HIDDEN);
});

test('formatRemaining shows mm:ss, and h:mm:ss from one hour', () => {
  assert.equal(formatRemaining(0), '00:00');
  assert.equal(formatRemaining(9), '00:09');
  assert.equal(formatRemaining(754), '12:34');
  assert.equal(formatRemaining(3599), '59:59');
  assert.equal(formatRemaining(3600), '1:00:00');
  assert.equal(formatRemaining(180 * 60), '3:00:00');
  assert.equal(formatRemaining(-20), '00:00');
});

test('msUntilNextSecond aligns the tick with the next change of the shown second', () => {
  assert.equal(msUntilNextSecond(12340, 0), 340);
  assert.equal(msUntilNextSecond(12000, 0), 1000);
  assert.equal(msUntilNextSecond(12340), 345);
  assert.equal(msUntilNextSecond(0), null);
  assert.equal(msUntilNextSecond(-10), null);
});

test('isStaleClock ignores clocks read earlier, or for an earlier phase', () => {
  const current = clock();
  assert.equal(isStaleClock(null, current), false);
  assert.equal(isStaleClock(current, clock({ serverNow: '2026-11-11T14:59:59.000Z' })), true);
  assert.equal(isStaleClock(current, clock({ serverNow: '2026-11-11T15:00:01.000Z' })), false);
  assert.equal(isStaleClock(current, clock({ phaseId: 30, phaseNumber: 1, serverNow: '2026-11-11T15:00:01.000Z' })), true);
  assert.equal(isStaleClock(current, clock({ finished: true, serverNow: '2026-11-11T15:00:01.000Z' })), false);
});

test('wasExtended sees a later deadline on the same phase', () => {
  assert.equal(wasExtended(clock(), clock({ endsAt: '2026-11-11T15:11:00.000Z' })), true);
  assert.equal(wasExtended(clock(), clock()), false);
  assert.equal(wasExtended(clock(), clock({ endsAt: '2026-11-11T15:10:00.500Z' })), false);
  assert.equal(wasExtended(clock(), clock({ phaseId: 32, phaseNumber: 3, endsAt: '2026-11-11T15:30:00.000Z' })), false);
  assert.equal(wasExtended(null, clock()), false);
});

test('crossedMilestone reports the latest milestone crossed', () => {
  assert.equal(crossedMilestone(301, 300), 'fiveMinutes');
  assert.equal(crossedMilestone(300, 299), null);
  assert.equal(crossedMilestone(60, 59), 'oneMinute');
  assert.equal(crossedMilestone(61, 60), null);
  assert.equal(crossedMilestone(1, 0), 'timeUp');
  assert.equal(crossedMilestone(0, 0), null);
  // After a sleep from 6 minutes left to 30 s, then to the end.
  assert.equal(crossedMilestone(360, 30), 'oneMinute');
  assert.equal(crossedMilestone(360, 0), 'timeUp');
  // Time added: the count went up.
  assert.equal(crossedMilestone(10, 70), null);
  assert.equal(crossedMilestone(null, 10), null);
});

test('spokenRemaining says the time in words', () => {
  const t = (key) => ({
    'phaseTimer.hour': 'hora',
    'phaseTimer.hours': 'horas',
    'phaseTimer.minute': 'minuto',
    'phaseTimer.minutes': 'minutos',
    'phaseTimer.second': 'segundo',
    'phaseTimer.seconds': 'segundos',
    'phaseTimer.and': 'y'
  })[key];

  assert.equal(spokenRemaining(754, t), '12 minutos y 34 segundos');
  assert.equal(spokenRemaining(60, t), '1 minuto');
  assert.equal(spokenRemaining(61, t), '1 minuto y 1 segundo');
  assert.equal(spokenRemaining(45, t), '45 segundos');
  assert.equal(spokenRemaining(0, t), '0 segundos');
  assert.equal(spokenRemaining(3600 + 125, t), '1 hora y 2 minutos');
  assert.equal(spokenRemaining(7200, t), '2 horas');
  assert.equal(spokenRemaining(598, t, { roundToMinutes: true }), '10 minutos');
  assert.equal(spokenRemaining(45, t, { roundToMinutes: true }), '45 segundos');
});

import { TIMER_STATES, spokenRemaining } from '../../utils/phaseClock.js';

const STATE_ICONS = {
  [TIMER_STATES.RUNNING]: 'fa-regular fa-clock',
  [TIMER_STATES.LAST_MINUTE]: 'fa-solid fa-clock',
  [TIMER_STATES.ADVANCING]: 'fa-solid fa-forward',
  [TIMER_STATES.TIME_UP]: 'fa-solid fa-hourglass-end'
};

const STATE_MESSAGE_KEYS = {
  [TIMER_STATES.LAST_MINUTE]: 'phaseTimer.lastMinute',
  [TIMER_STATES.ADVANCING]: 'phaseTimer.advancing',
  [TIMER_STATES.TIME_UP]: 'phaseTimer.timeUp'
};

function announcementText(announcement, t) {
  if (!announcement) return '';

  const time = spokenRemaining(announcement.remainingSeconds, t, { roundToMinutes: true });
  switch (announcement.kind) {
    case 'fiveMinutes':
      return t('phaseTimer.announceFiveMinutes');
    case 'oneMinute':
      return t('phaseTimer.lastMinute');
    case 'timeUp':
      return t('phaseTimer.timeUp');
    case 'advancing':
      return t('phaseTimer.advancing');
    case 'newPhase':
      return t('phaseTimer.announceNewPhase', { time });
    case 'extended':
      return t('phaseTimer.announceExtended', { time });
    default:
      return '';
  }
}

/**
 * The time left in the current phase (epic #1105, #1117), as a strip that
 * stays at the top of the activity while the student scrolls.
 *
 * The digits are hidden from screen readers, which read the time in words
 * when they reach the strip. A polite live region says only the moments
 * that matter (phaseClockTracker.js): 5 minutes left, the last minute, time
 * up, a new phase and added time. It stays mounted while the strip is
 * hidden, so those moments are said on any tab.
 *
 * @param {object} props
 * @param {object} props.timer - useActivityPhaseTimer()'s snapshot.
 * @param {boolean} props.visible - The student is on the case or on the
 *     current phase.
 * @param {(key: string, params?: object) => string} props.t
 */
export default function PhaseTimer({ timer, visible, t }) {
  const { state, announcement } = timer;
  const showStrip = visible && state !== TIMER_STATES.HIDDEN;
  const counting = state === TIMER_STATES.RUNNING || state === TIMER_STATES.LAST_MINUTE;
  const messageKey = STATE_MESSAGE_KEYS[state];
  const spoken = announcementText(announcement, t);

  return (
    <>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {/* A new node per announcement, so the same words said twice are
            read twice. */}
        {spoken ? <span key={announcement.id}>{spoken}</span> : null}
      </div>

      {showStrip ? (
        <div className={`phase-timer phase-timer--${state}`}>
          <i className={`phase-timer__icon ${STATE_ICONS[state]}`} aria-hidden="true" />
          {counting ? (
            <span className="phase-timer__count">
              <span className="phase-timer__label">{t('phaseTimer.timeLeft')}</span>
              <span className="phase-timer__digits" aria-hidden="true">{timer.display}</span>
              <span className="visually-hidden">{spokenRemaining(timer.remainingSeconds, t)}</span>
            </span>
          ) : null}
          {messageKey ? <span className="phase-timer__message">{t(messageKey)}</span> : null}
          {timer.extended ? (
            <span className="phase-timer__extended">
              <i className="fa-solid fa-circle-plus" aria-hidden="true" />
              <span>{t('phaseTimer.extended')}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

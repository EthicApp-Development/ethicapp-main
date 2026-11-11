import { useEffect, useRef, useState } from 'react';
import { legacyUserApi } from '../../../api/studentApi.js';
import { getStudentSocket } from '../../../services/studentSocket.js';
import { errorLogDetails } from '../../../utils/logDetails.js';
import { createReconnectTracker } from '../externalResultsLoading.js';
import { HIDDEN_TIMER_SNAPSHOT, createPhaseClockTracker } from '../phaseClockTracker.js';

function fetchPhaseClock(sessionId) {
  return legacyUserApi.get(`/activities/${sessionId}/clock`).then(({ data }) => data);
}

/**
 * The current phase's clock for the activity view (epic #1105, #1117): a
 * phaseClockTracker fed by GET /activities/:id/clock, the `onPhaseClock` and
 * `onPhaseTransition` socket events, socket reconnects and the page becoming
 * visible.
 *
 * It listens on the shared student socket next to useActivityRealtimeSync,
 * which joins the session's room and rejoins it after a reconnect (#1108).
 *
 * @param {object} options
 * @param {number} options.sessionId
 * @param {boolean} options.enabled - The activity is in progress.
 * @param {number|null} [options.currentPhaseId] - The page's current phase;
 *     a change the clock did not hear of makes it read the clock again.
 * @returns {object} The tracker's snapshot (HIDDEN_TIMER_SNAPSHOT documents
 *     it); "hidden" while disabled.
 */
export function useActivityPhaseTimer({ sessionId, enabled, currentPhaseId = null }) {
  const [timer, setTimer] = useState(HIDDEN_TIMER_SNAPSHOT);
  const trackerRef = useRef(null);
  const activeSessionId = Number(sessionId);
  const isActive = Boolean(enabled) && Number.isInteger(activeSessionId) && activeSessionId > 0;

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    let disposed = false;
    let socket = null;
    let reconnects = createReconnectTracker();
    const tracker = createPhaseClockTracker({
      sessionId: activeSessionId,
      fetchClock: fetchPhaseClock,
      onChange: (snapshot) => {
        if (!disposed) setTimer(snapshot);
      },
      onError: (error) => {
        console.debug('[student] could not read the phase clock', {
          sessionId: activeSessionId,
          ...errorLogDetails(error)
        });
      }
    });
    trackerRef.current = tracker;
    tracker.start();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') tracker.pageVisible();
    };
    const handleConnect = () => {
      if (reconnects.handleConnect()) tracker.reconnected();
    };
    const handlePhaseClock = (payload) => tracker.handleClock(payload);
    const handlePhaseTransition = (payload) => tracker.handlePhaseTransition(payload);

    document.addEventListener('visibilitychange', handleVisibilityChange);

    getStudentSocket()
      .then((instance) => {
        if (disposed) return;
        socket = instance;
        reconnects = createReconnectTracker({ connected: socket.connected });
        socket.on('connect', handleConnect);
        socket.on('onPhaseClock', handlePhaseClock);
        socket.on('onPhaseTransition', handlePhaseTransition);
      })
      .catch(() => {
        // useActivityRealtimeSync reports the socket's failures; the clock
        // is still read on load and when the page becomes visible.
      });

    return () => {
      disposed = true;
      tracker.dispose();
      if (trackerRef.current === tracker) trackerRef.current = null;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (socket) {
        socket.off('connect', handleConnect);
        socket.off('onPhaseClock', handlePhaseClock);
        socket.off('onPhaseTransition', handlePhaseTransition);
      }
      setTimer(HIDDEN_TIMER_SNAPSHOT);
    };
  }, [activeSessionId, isActive]);

  useEffect(() => {
    trackerRef.current?.phaseChanged(currentPhaseId);
  }, [currentPhaseId, isActive]);

  return timer;
}

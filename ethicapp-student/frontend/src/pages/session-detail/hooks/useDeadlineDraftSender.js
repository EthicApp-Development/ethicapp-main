import { useCallback, useEffect, useRef, useState } from 'react';
import { getStudentSocket } from '../../../services/studentSocket.js';
import { errorLogDetails } from '../../../utils/logDetails.js';
import { unsentDrafts } from '../../../utils/phaseDrafts.js';
import { createDeadlineDraftSender, deadlineNoticeFor, previousPhaseId } from '../deadlineDraftSender.js';

function phaseById(phases, phaseId) {
  return Array.isArray(phases) ? phases.find((phase) => Number(phase?.id) === Number(phaseId)) ?? null : null;
}

/**
 * Sends the student's unsent answers when a hard-mode phase runs out of
 * time (#1118): a deadlineDraftSender fed by the phase clock's snapshots
 * and the `onPhaseTransition` socket event.
 *
 * @param {object} options
 * @param {number} options.sessionId
 * @param {number} options.userId
 * @param {boolean} options.enabled - The activity is in progress and its design keeps drafts.
 * @param {object} options.timer - useActivityPhaseTimer()'s snapshot.
 * @param {Array<object>} options.phases - full_state's phases.
 * @param {{ current: object }} options.draftsRef - usePhaseDrafts()'s drafts by phase.
 * @param {Function} options.submitActivityResponse
 * @param {Function} options.loadFullState
 * @returns {{ trackManual: Function, outcomesByPhaseId: object, notice: object|null, dismissNotice: Function }}
 */
export function useDeadlineDraftSender({
  sessionId,
  userId,
  enabled,
  timer,
  phases,
  draftsRef,
  submitActivityResponse,
  loadFullState
}) {
  const [outcomesByPhaseId, setOutcomesByPhaseId] = useState({});
  const [notice, setNotice] = useState(null);
  const senderRef = useRef(null);
  const noticeSeqRef = useRef(0);
  const phasesRef = useRef(phases);
  const dependenciesRef = useRef({ submitActivityResponse, loadFullState, userId });
  const activeSessionId = Number(sessionId);
  const isActive = Boolean(enabled) && Number.isInteger(activeSessionId) && activeSessionId > 0;

  phasesRef.current = phases;
  dependenciesRef.current = { submitActivityResponse, loadFullState, userId };

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    let disposed = false;
    let socket = null;

    const sender = createDeadlineDraftSender({
      collectUnsent: (phaseId) => unsentDrafts(phaseById(phasesRef.current, phaseId), draftsRef.current?.[phaseId]),
      submit: (responsePayload) => dependenciesRef.current.submitActivityResponse({
        sessionId: activeSessionId,
        responsePayload
      }),
      afterSent: () => dependenciesRef.current.loadFullState({
        sessionId: activeSessionId,
        userId: dependenciesRef.current.userId,
        invalidate: true
      }),
      onOutcome: ({ phaseId, outcomes, final }) => {
        if (disposed) return;
        setOutcomesByPhaseId((previous) => ({ ...previous, [phaseId]: outcomes }));
        if (!final) return;

        const phaseNumber = Number(phaseById(phasesRef.current, phaseId)?.number) || null;
        const next = deadlineNoticeFor(phaseId, phaseNumber, outcomes);
        if (!next) return;
        setNotice((current) => (
          current && current.phaseId === next.phaseId && current.sent === next.sent && current.kept === next.kept
            ? current
            : { ...next, id: (noticeSeqRef.current += 1) }
        ));
      },
      onError: (error) => {
        // Ids, and the error's name, code and status: an answer can quote the
        // student (#1139).
        console.debug('[student] could not send an answer at the deadline', {
          sessionId: activeSessionId,
          ...errorLogDetails(error)
        });
      }
    });
    senderRef.current = sender;

    const handlePhaseTransition = (payload) => {
      const payloadSessionId = Number(payload?.sessionId);
      if (Number.isInteger(payloadSessionId) && payloadSessionId > 0 && payloadSessionId !== activeSessionId) return;
      sender.phaseTransition(payload, previousPhaseId(phasesRef.current, payload?.phaseNumber));
    };

    getStudentSocket()
      .then((instance) => {
        if (disposed) return;
        socket = instance;
        socket.on('onPhaseTransition', handlePhaseTransition);
      })
      .catch(() => {
        // useActivityRealtimeSync reports the socket's failures; the
        // deadline timers still send.
      });

    return () => {
      disposed = true;
      sender.dispose();
      if (senderRef.current === sender) senderRef.current = null;
      if (socket) socket.off('onPhaseTransition', handlePhaseTransition);
    };
  }, [activeSessionId, draftsRef, isActive]);

  // Kept when the activity ends, so the last phase's notice stays; another
  // activity starts without them.
  useEffect(() => () => {
    setOutcomesByPhaseId({});
    setNotice(null);
  }, [activeSessionId]);

  useEffect(() => {
    senderRef.current?.timerChanged(timer);
  }, [timer, isActive]);

  const trackManual = useCallback((payload, send) => (
    senderRef.current ? senderRef.current.trackManual(payload, send) : Promise.resolve().then(send)
  ), []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { trackManual, outcomesByPhaseId, notice, dismissNotice };
}

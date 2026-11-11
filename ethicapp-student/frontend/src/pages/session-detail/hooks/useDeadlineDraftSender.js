import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getStudentSocket } from '../../../services/studentSocket.js';
import { errorLogDetails } from '../../../utils/logDetails.js';
import { createDraftOutcomeStore, unsentDrafts } from '../../../utils/phaseDrafts.js';
import {
  createDeadlineDraftSender,
  nextOutcomeRecord,
  noticeFromRecords,
  previousPhaseId,
  storedOutcomeRecord
} from '../deadlineDraftSender.js';

const sharedOutcomeStore = createDraftOutcomeStore();

function phaseById(phases, phaseId) {
  return Array.isArray(phases) ? phases.find((phase) => Number(phase?.id) === Number(phaseId)) ?? null : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Sends the student's unsent answers when a hard-mode phase runs out of
 * time (#1118): a deadlineDraftSender fed by the phase clock's snapshots
 * and the `onPhaseTransition` socket event.
 *
 * What became of each phase's drafts is kept on the device next to the
 * drafts (utils/phaseDrafts.js, `createDraftOutcomeStore`), so the notes
 * under the tasks and the page notice outlive a reload, and a sender
 * created again starts from them.
 *
 * @param {object} options
 * @param {number} options.sessionId
 * @param {number} options.userId
 * @param {boolean} options.canRestore - The design keeps drafts and the activity started (or finished).
 * @param {boolean} options.enabled - Also in progress: the sender runs.
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
  canRestore,
  enabled,
  timer,
  phases,
  draftsRef,
  submitActivityResponse,
  loadFullState,
  store = sharedOutcomeStore
}) {
  const [recordsByPhaseId, setRecordsByPhaseId] = useState({});
  const recordsRef = useRef(recordsByPhaseId);
  const loadedPhaseIdsRef = useRef(new Set());
  const senderRef = useRef(null);
  const phasesRef = useRef(phases);
  const dependenciesRef = useRef({ submitActivityResponse, loadFullState });
  const activeSessionId = positiveInteger(sessionId);
  const activeUserId = positiveInteger(userId);
  const scopeKey = `${activeUserId}:${activeSessionId}`;
  const canKeep = Boolean(canRestore) && activeSessionId !== null && activeUserId !== null;
  const isActive = canKeep && Boolean(enabled);

  phasesRef.current = phases;
  dependenciesRef.current = { submitActivityResponse, loadFullState };

  const scopeOf = useCallback((phaseId) => ({
    userId: activeUserId,
    sessionId: activeSessionId,
    phaseId
  }), [activeSessionId, activeUserId]);

  const applyRecord = useCallback((phaseId, record) => {
    recordsRef.current = { ...recordsRef.current, [phaseId]: record };
    setRecordsByPhaseId(recordsRef.current);
    store.save(scopeOf(phaseId), storedOutcomeRecord(record));
  }, [scopeOf, store]);

  // Another activity or user starts from nothing.
  useEffect(() => {
    recordsRef.current = {};
    loadedPhaseIdsRef.current = new Set();
    setRecordsByPhaseId({});
  }, [scopeKey]);

  useEffect(() => {
    if (canKeep) store.prune();
  }, [canKeep, scopeKey, store]);

  // Each phase's outcomes come back from the device once, when the phase
  // first appears.
  useEffect(() => {
    if (!canKeep || !Array.isArray(phases)) return;

    const restored = {};
    phases.forEach((phase) => {
      const phaseId = positiveInteger(phase?.id);
      if (phaseId === null || loadedPhaseIdsRef.current.has(phaseId)) return;
      loadedPhaseIdsRef.current.add(phaseId);
      const record = store.load(scopeOf(phaseId));
      if (record && !recordsRef.current[phaseId]) restored[phaseId] = record;
    });

    if (Object.keys(restored).length > 0) {
      recordsRef.current = { ...restored, ...recordsRef.current };
      setRecordsByPhaseId(recordsRef.current);
    }
  }, [canKeep, phases, scopeOf, store]);

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
        userId: activeUserId,
        invalidate: true
      }),
      loadOutcomes: (phaseId) => (
        recordsRef.current[phaseId]?.tasks ?? store.load(scopeOf(phaseId))?.tasks ?? {}
      ),
      onOutcome: (report) => {
        if (disposed) return;
        const previous = recordsRef.current[report.phaseId] ?? store.load(scopeOf(report.phaseId));
        applyRecord(report.phaseId, nextOutcomeRecord(previous, report));
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
  }, [activeSessionId, activeUserId, applyRecord, draftsRef, isActive, scopeOf, store]);

  useEffect(() => {
    senderRef.current?.timerChanged(timer);
  }, [timer, isActive]);

  const trackManual = useCallback((payload, send) => (
    senderRef.current ? senderRef.current.trackManual(payload, send) : Promise.resolve().then(send)
  ), []);

  const outcomesByPhaseId = useMemo(() => Object.fromEntries(
    Object.entries(recordsByPhaseId).map(([phaseId, record]) => [phaseId, record?.tasks ?? {}])
  ), [recordsByPhaseId]);

  const notice = useMemo(() => noticeFromRecords(recordsByPhaseId, phases), [phases, recordsByPhaseId]);

  const dismissNotice = useCallback(() => {
    if (!notice) return;
    const record = recordsRef.current[notice.phaseId];
    if (record) applyRecord(notice.phaseId, { ...record, dismissed: true });
  }, [applyRecord, notice]);

  return { trackManual, outcomesByPhaseId, notice, dismissNotice };
}

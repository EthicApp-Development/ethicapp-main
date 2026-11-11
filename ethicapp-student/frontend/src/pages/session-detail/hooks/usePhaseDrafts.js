import { useCallback, useEffect, useRef, useState } from 'react';
import { createPhaseDraftStore, keepUnsavedDrafts } from '../../../utils/phaseDrafts.js';

const sharedStore = createPhaseDraftStore();

/**
 * The student's unsent answers of an activity, by phase and task (#1118):
 * page state mirrored on the device (utils/phaseDrafts.js), so a reload
 * restores them.
 *
 * - A phase's drafts are restored once, when the phase first appears in the
 *   activity state; what the page already holds wins over the device.
 * - The device keeps only drafts that differ from the stored answers, and is
 *   brought up to date whenever the drafts or the stored answers change: an
 *   answer submitted, by the student or for them, leaves no draft behind
 *   once the activity state is reloaded.
 *
 * @param {object} options
 * @param {number} options.userId
 * @param {number} options.sessionId
 * @param {Array<object>} options.phases - full_state's phases.
 * @param {boolean} options.enabled - The design keeps drafts (semantic differential).
 * @returns {{ draftsByPhaseId: object, draftsRef: { current: object }, setTaskDraft: Function }}
 */
export function usePhaseDrafts({ userId, sessionId, phases, enabled, store = sharedStore }) {
  const [draftsByPhaseId, setDraftsByPhaseId] = useState({});
  const draftsRef = useRef(draftsByPhaseId);
  const restoredPhaseIdsRef = useRef(new Set());
  const scopeKey = `${Number(userId)}:${Number(sessionId)}`;
  const isActive = Boolean(enabled) && Number.isInteger(Number(userId)) && Number(userId) > 0
    && Number.isInteger(Number(sessionId)) && Number(sessionId) > 0;

  draftsRef.current = draftsByPhaseId;

  // Another activity or user starts from nothing.
  useEffect(() => {
    restoredPhaseIdsRef.current = new Set();
    draftsRef.current = {};
    setDraftsByPhaseId({});
  }, [scopeKey]);

  // Expired drafts go when an activity that keeps drafts opens.
  useEffect(() => {
    if (isActive) store.prune();
  }, [isActive, scopeKey, store]);

  useEffect(() => {
    if (!isActive || !Array.isArray(phases)) return;

    const restored = {};
    phases.forEach((phase) => {
      const phaseId = Number(phase?.id);
      if (!Number.isInteger(phaseId) || phaseId <= 0 || restoredPhaseIdsRef.current.has(phaseId)) return;
      restoredPhaseIdsRef.current.add(phaseId);

      const scope = { userId, sessionId, phaseId };
      const kept = keepUnsavedDrafts(phase, store.load(scope));
      // Drafts submitted since they were kept are of no further use.
      store.save(scope, kept);
      if (Object.keys(kept).length > 0) restored[phaseId] = kept;
    });

    if (Object.keys(restored).length > 0) {
      setDraftsByPhaseId((previous) => {
        const next = { ...previous };
        Object.entries(restored).forEach(([phaseId, tasks]) => {
          const current = previous[phaseId] ?? {};
          next[phaseId] = { ...tasks };
          Object.entries(current).forEach(([taskId, draft]) => {
            next[phaseId][taskId] = { ...(tasks[taskId] ?? {}), ...draft };
          });
        });
        return next;
      });
    }
  }, [isActive, phases, sessionId, store, userId]);

  // The device follows the page, phase by phase.
  useEffect(() => {
    if (!isActive || !Array.isArray(phases)) return;

    phases.forEach((phase) => {
      const phaseId = Number(phase?.id);
      if (!restoredPhaseIdsRef.current.has(phaseId) || !draftsByPhaseId[phaseId]) return;
      store.save({ userId, sessionId, phaseId }, keepUnsavedDrafts(phase, draftsByPhaseId[phaseId]));
    });
  }, [draftsByPhaseId, isActive, phases, sessionId, store, userId]);

  const setTaskDraft = useCallback((phaseId, taskId, partialUpdate) => {
    if (!Number.isInteger(phaseId) || phaseId <= 0) {
      return;
    }

    setDraftsByPhaseId((previous) => ({
      ...previous,
      [phaseId]: {
        ...(previous[phaseId] ?? {}),
        [taskId]: {
          ...((previous[phaseId] ?? {})[taskId] ?? {}),
          ...partialUpdate
        }
      }
    }));
  }, []);

  return { draftsByPhaseId, draftsRef, setTaskDraft };
}

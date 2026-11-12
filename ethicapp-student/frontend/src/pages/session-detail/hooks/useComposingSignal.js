import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createComposingSignal } from '../composingSignal.js';

/**
 * Sends the group chat's composing signals (epic #601, #656) through a
 * composingSignal controller, which holds the timing.
 *
 * The composer calls `edited()` when its draft changes, and `stopped()` on
 * blur and on submit. A change of socket, phase, question or group, `enabled`
 * turning false, and unmounting send `stopped` when a `composing` is
 * pending; unmounting also cancels the idle timer.
 *
 * @param {object} options
 * @param {object|null} options.socket - The student socket while it is
 *     connected (useActivityRealtimeSync's `connectedSocket`); null while the
 *     view polls, which sends nothing.
 * @param {number} options.phaseId
 * @param {number} options.questionId
 * @param {number} options.groupId
 * @param {boolean} options.enabled - The chat accepts the student's
 *     messages: open, not read-only, in the current phase.
 * @returns {{ edited: () => void, stopped: () => void }}
 */
export function useComposingSignal({ socket, phaseId, questionId, groupId, enabled }) {
  const controllerRef = useRef(null);

  useEffect(() => {
    const controller = createComposingSignal();
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  // Declared after the controller's effect, so it runs after it on mount.
  useEffect(() => {
    controllerRef.current?.update({ socket, phaseId, questionId, groupId, enabled: Boolean(enabled) });
  }, [enabled, groupId, phaseId, questionId, socket]);

  const edited = useCallback(() => controllerRef.current?.edited(), []);
  const stopped = useCallback(() => controllerRef.current?.stop(), []);

  return useMemo(() => ({ edited, stopped }), [edited, stopped]);
}

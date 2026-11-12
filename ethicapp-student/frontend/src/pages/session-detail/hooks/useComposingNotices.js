import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_COMPOSING_NOTICE_EVENT } from '../../../utils/composingSignalContract.js';
import { createComposingNotices } from '../composingNotices.js';

const NO_WRITERS = Object.freeze([]);

/**
 * Who else is writing in the group chat (epic #601, #1007), from the
 * `onChatComposing` notices of the student socket, through a composingNotices
 * controller, which holds the expiry and the filtering.
 *
 * Listens only while `enabled` and a connected socket is given. A change of
 * socket (a reconnect passes through null), phase, group or question, and
 * `enabled` turning false, forget every writer.
 *
 * The chat times each transcript load with `transcriptRequested()` and
 * reports it with `transcriptLoaded(messages, { groupId, questionId,
 * requestedAt })`, so that a writer's message removes them.
 *
 * @param {object} options
 * @param {object|null} options.socket - useActivityRealtimeSync's
 *     `connectedSocket`; null while the view polls, when no notice arrives.
 * @param {number} options.phaseId
 * @param {number} options.groupId
 * @param {number} options.questionId
 * @param {number} options.userId - The student, whose own notices are ignored.
 * @param {boolean} options.enabled - The chat is shown and accepts messages.
 * @returns {{
 *   writers: Array<{ userId: number, role: string, name: string|null }>,
 *   transcriptRequested: () => number,
 *   transcriptLoaded: (messages: Array<{ id: number, authorId: number|null }>, load: { groupId: number, questionId: number, requestedAt: number }) => void
 * }}
 */
export function useComposingNotices({ socket, phaseId, groupId, questionId, userId, enabled }) {
  const [writers, setWriters] = useState(NO_WRITERS);
  const controllerRef = useRef(null);

  useEffect(() => {
    const controller = createComposingNotices({ onChange: setWriters });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, []);

  const listening = Boolean(enabled && socket);

  // Declared after the controller's effect, so it runs after it on mount.
  useEffect(() => {
    const controller = controllerRef.current;
    controller?.update({ phaseId, groupId, questionId, selfUserId: userId, enabled: listening });
    if (!listening || !controller) return undefined;

    const handleNotice = (notice) => controller.receive(notice);
    socket.on(CHAT_COMPOSING_NOTICE_EVENT, handleNotice);
    return () => {
      socket.off(CHAT_COMPOSING_NOTICE_EVENT, handleNotice);
      // Notices missed while another socket listens are not replayed.
      controller.reset();
    };
  }, [groupId, listening, phaseId, questionId, socket, userId]);

  const transcriptRequested = useCallback(() => controllerRef.current?.now() ?? Date.now(), []);
  const transcriptLoaded = useCallback((messages, load) => {
    controllerRef.current?.transcriptLoaded(messages, load);
  }, []);

  return useMemo(
    () => ({ writers, transcriptRequested, transcriptLoaded }),
    [writers, transcriptRequested, transcriptLoaded]
  );
}

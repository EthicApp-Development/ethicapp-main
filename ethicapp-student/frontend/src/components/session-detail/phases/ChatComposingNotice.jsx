import { useMemo } from 'react';
import { composingNoticeText } from '../../../pages/session-detail/composingNoticeText.js';

// One line is kept for the notice, so the messages do not move when it
// appears or goes away.
const NOTICE_HEIGHT = '1.8rem';

/**
 * "Ana is typing…" below the group chat's messages (epic #601, #1007).
 *
 * The live region stays in the page while the chat is open, empty when
 * nobody is writing, so that screen readers announce the notice when it
 * appears. Its text changes only when the writers do, never when a notice
 * merely extends one, so it is not announced again every few seconds.
 */
export default function ChatComposingNotice({ writers, t }) {
  const text = useMemo(() => composingNoticeText(writers, t), [writers, t]);

  return (
    <div className="small text-muted fst-italic text-truncate px-3 py-1" style={{ minHeight: NOTICE_HEIGHT }} aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}

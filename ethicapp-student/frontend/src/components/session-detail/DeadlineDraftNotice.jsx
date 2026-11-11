function noticeSentences({ phaseNumber, sent, kept }, t) {
  const number = phaseNumber ?? '';
  const sentences = [];

  if (sent > 0) {
    sentences.push(t(sent === 1 ? 'phaseDrafts.noticeSentOne' : 'phaseDrafts.noticeSentOther', { number, count: sent }));
  }
  if (kept > 0) {
    sentences.push(t(kept === 1 ? 'phaseDrafts.noticeKeptOne' : 'phaseDrafts.noticeKeptOther', { number, count: kept }));
  }
  return sentences;
}

/**
 * What became of the student's unsent answers when a hard-mode phase ran
 * out of time (#1118): sent for them, or kept on the device. Shown above
 * the tabs, on any tab, until dismissed or replaced by the next phase's.
 *
 * The polite live region stays mounted, so a screen reader says the notice
 * when it appears.
 *
 * @param {object} props
 * @param {{ id: number, phaseNumber: number|null, sent: number, kept: number }|null} props.notice
 * @param {() => void} props.onDismiss
 * @param {(key: string, params?: object) => string} props.t
 */
export default function DeadlineDraftNotice({ notice, onDismiss, t }) {
  const sentences = notice ? noticeSentences(notice, t) : [];
  const tone = notice?.kept > 0 ? 'warning' : 'success';

  return (
    <div aria-live="polite" aria-atomic="true">
      {sentences.length > 0 ? (
        <div
          key={notice.id}
          className={`alert alert-${tone} d-flex align-items-start gap-2 py-2 mt-3 mb-0`}
        >
          <i
            className={`fa-solid ${notice.kept > 0 ? 'fa-floppy-disk' : 'fa-circle-check'} mt-1`}
            aria-hidden="true"
          />
          <div className="flex-grow-1">
            {sentences.map((sentence) => (
              <p key={sentence} className="mb-0">{sentence}</p>
            ))}
          </div>
          <button
            type="button"
            className="btn-close"
            aria-label={t('phaseDrafts.dismissNotice')}
            onClick={onDismiss}
          />
        </div>
      ) : null}
    </div>
  );
}

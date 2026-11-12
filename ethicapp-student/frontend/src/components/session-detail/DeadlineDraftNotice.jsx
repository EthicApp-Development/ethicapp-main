// `phaseOpen`: the phase still takes answers (the last phase of a
// hard-mode activity until the teacher finishes it), so a draft not sent
// can still be submitted by the student.
function noticeSentences({ phaseNumber, sent, kept }, phaseOpen, t) {
  const number = phaseNumber ?? '';
  const sentences = [];

  if (sent > 0) {
    sentences.push(t(sent === 1 ? 'phaseDrafts.noticeSentOne' : 'phaseDrafts.noticeSentOther', { number, count: sent }));
  }
  if (kept > 0) {
    const keys = phaseOpen
      ? ['phaseDrafts.noticeOpenOne', 'phaseDrafts.noticeOpenOther']
      : ['phaseDrafts.noticeKeptOne', 'phaseDrafts.noticeKeptOther'];
    sentences.push(t(kept === 1 ? keys[0] : keys[1], { number, count: kept }));
  }
  return sentences;
}

const NOTICE_STYLES = {
  sent: { tone: 'success', iconClass: 'fa-circle-check' },
  kept: { tone: 'warning', iconClass: 'fa-floppy-disk' },
  open: { tone: 'info', iconClass: 'fa-pen-to-square' }
};

/**
 * What became of the student's unsent answers when a hard-mode phase ran
 * out of time (#1118): sent for them, kept on the device, or still to be
 * submitted while the phase takes answers. Shown above the tabs, on any
 * tab and after a reload, until dismissed or replaced by a later phase's.
 *
 * The polite live region stays mounted, so a screen reader says the notice
 * when it appears.
 *
 * @param {object} props
 * @param {{ phaseId: number, phaseNumber: number|null, sent: number, kept: number }|null} props.notice
 * @param {boolean} props.phaseOpen - The notice's phase still takes answers.
 * @param {() => void} props.onDismiss
 * @param {(key: string, params?: object) => string} props.t
 */
export default function DeadlineDraftNotice({ notice, phaseOpen, onDismiss, t }) {
  const sentences = notice ? noticeSentences(notice, phaseOpen, t) : [];
  const style = NOTICE_STYLES[!notice?.kept ? 'sent' : (phaseOpen ? 'open' : 'kept')];

  return (
    <div aria-live="polite" aria-atomic="true">
      {sentences.length > 0 ? (
        <div
          key={`${notice.phaseId}:${notice.sent}:${notice.kept}:${phaseOpen ? 'open' : 'closed'}`}
          className={`alert alert-${style.tone} d-flex align-items-start gap-2 py-2 mt-3 mb-0`}
        >
          <i
            className={`fa-solid ${style.iconClass} mt-1`}
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

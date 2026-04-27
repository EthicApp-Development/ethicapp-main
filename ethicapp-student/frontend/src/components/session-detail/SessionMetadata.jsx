import { formatSessionDate, sessionStatusLabel } from '../../utils/sessionFormat.js';

export default function SessionMetadata({ selectedSession, locale, t, currentPhaseNumber, currentPhaseId }) {
  return (
    <>
      <h2 className="h5 mb-2">{selectedSession.name ?? `${t('sessions.sessionFallbackName')} #${selectedSession.id}`}</h2>
      <p className="text-secondary mb-3">{selectedSession.descr || t('sessionDetail.noDescription')}</p>

      <dl className="row mb-0">
        <dt className="col-sm-3">{t('sessionDetail.status')}</dt>
        <dd className="col-sm-9">{sessionStatusLabel(selectedSession.status, t)}</dd>

        <dt className="col-sm-3">{t('sessionDetail.date')}</dt>
        <dd className="col-sm-9">{formatSessionDate(selectedSession.time, locale, t)}</dd>

        <dt className="col-sm-3">{t('sessionDetail.code')}</dt>
        <dd className="col-sm-9">{selectedSession.code ?? t('sessionDetail.unavailable')}</dd>

        <dt className="col-sm-3">{t('sessionDetail.type')}</dt>
        <dd className="col-sm-9">{selectedSession.type ?? t('sessionDetail.noType')}</dd>

        <dt className="col-sm-3">{t('sessionDetail.activePhaseNumber')}</dt>
        <dd className="col-sm-9">{currentPhaseNumber ?? t('sessionDetail.unavailable')}</dd>

        <dt className="col-sm-3">{t('sessionDetail.activePhaseId')}</dt>
        <dd className="col-sm-9">{currentPhaseId ?? t('sessionDetail.unavailable')}</dd>
      </dl>
    </>
  );
}

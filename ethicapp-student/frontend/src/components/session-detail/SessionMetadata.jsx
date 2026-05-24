import { useState } from 'react';
import { showDevMetadata } from '../../config/env.js';
import { formatSessionDate, sessionStatusLabel } from '../../utils/sessionFormat.js';

export default function SessionMetadata({ selectedSession, locale, t, currentPhaseNumber, currentPhaseId }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!showDevMetadata) {
    return null;
  }

  return (
    <section className="card border-0 shadow-sm mt-4" aria-label={t('sessionDetail.developerInfoTitle')}>
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <h2 className="h6 mb-0">{t('sessionDetail.developerInfoTitle')}</h2>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
            aria-controls="developer-session-metadata"
          >
            <span className="d-inline-flex align-items-center gap-2">
              <i className={`fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden="true" />
              <span>{isExpanded ? t('sessionDetail.hideDeveloperInfo') : t('sessionDetail.showDeveloperInfo')}</span>
            </span>
          </button>
        </div>

        {isExpanded ? (
          <>
            <hr className="my-3" />
            <dl id="developer-session-metadata" className="row mb-0">
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
        ) : null}
      </div>
    </section>
  );
}

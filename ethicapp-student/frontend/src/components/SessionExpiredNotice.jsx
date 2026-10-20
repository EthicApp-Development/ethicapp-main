import { useSyncExternalStore } from 'react';
import { useI18n } from '../app/providers.jsx';
import { sessionExpiryFlow } from '../api/sessionExpiry.js';

export default function SessionExpiredNotice() {
  const { t } = useI18n();
  const expiry = useSyncExternalStore(sessionExpiryFlow.subscribe, sessionExpiryFlow.getSnapshot);

  if (!expiry) {
    return null;
  }

  return (
    <div className="session-expired-notice position-fixed top-0 start-50 translate-middle-x mt-3 px-3">
      <div className="alert alert-warning shadow d-flex flex-wrap align-items-center gap-3 mb-0" role="alert">
        <span className="d-inline-flex align-items-center gap-2">
          <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
          <span>{t('apiErrors.sessionExpired')}</span>
        </span>
        <a className="btn btn-sm btn-warning" href={expiry.signInUrl}>{t('apiErrors.signInNow')}</a>
      </div>
    </div>
  );
}

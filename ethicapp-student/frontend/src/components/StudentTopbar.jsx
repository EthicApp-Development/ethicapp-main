import { useI18n } from '../app/providers.jsx';

const ETHICAPP_LOGO_SRC = '/images/logos/ethicapp-logo.svg';

export default function StudentTopbar({ loadingSession, userDisplayName, onLogout }) {
  const { t } = useI18n();

  return (
    <header className="student-topbar">
      <div className="student-topbar-inner container-fluid container-lg">
        <div className="student-topbar-left">
          <a href="https://www.ethicapp.info" target="_blank" className="ethicapp-logo-topbar" rel="noreferrer">
            <img
              src={ETHICAPP_LOGO_SRC}
              alt={t('common.appName')}
              className="ethicapp-logo-topbar-img"
            />
          </a>
        </div>
        <div className="student-topbar-actions">
          <span className="student-profile-link">
            <i className="fa-solid fa-user" aria-hidden="true" />
            <span className="student-profile-name">
              {loadingSession ? t('common.loadingUser') : userDisplayName}
            </span>
          </span>
          <button
            type="button"
            className="student-logout-link"
            onClick={onLogout}
            title={t('common.logout')}
            aria-label={t('common.logout')}
          >
            <i className="fa-solid fa-right-from-bracket" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}

import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useI18n } from '../app/providers.jsx';
import JoinSessionCard from '../components/JoinSessionCard.jsx';
import SessionList from '../components/SessionList.jsx';

const TABS = {
  JOIN: 'join-session',
  PREVIOUS: 'previous-sessions'
};

export default function HomePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { loadingSession, session, sessionRefreshKey, onSessionJoined } = useOutletContext();
  const [activeTab, setActiveTab] = useState(TABS.JOIN);

  const handleSessionSelect = (sessionId) => {
    navigate(`/sessions/${sessionId}`);
  };

  const handleSessionJoined = (sessionId) => {
    onSessionJoined();

    if (Number.isInteger(sessionId) && sessionId > 0) {
      navigate(`/sessions/${sessionId}`);
    }
  };

  return (
    <div className="d-flex flex-column gap-4">
      <nav>
        <div className="nav nav-tabs" role="tablist" aria-label={t('navigation.sessionsNavigation')}>
          <button
            type="button"
            className={`nav-link ${activeTab === TABS.JOIN ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === TABS.JOIN}
            onClick={() => setActiveTab(TABS.JOIN)}
          >
            <span className="d-inline-flex align-items-center gap-2">
              <i className="fa-solid fa-right-to-bracket" aria-hidden="true" />
              <span>{t('navigation.joinSession')}</span>
            </span>
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === TABS.PREVIOUS ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === TABS.PREVIOUS}
            onClick={() => setActiveTab(TABS.PREVIOUS)}
          >
            <span className="d-inline-flex align-items-center gap-2">
              <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
              <span>{t('navigation.previousSessions')}</span>
            </span>
          </button>
        </div>
      </nav>

      {activeTab === TABS.JOIN ? (
        <div className="row g-4">
          <section className="col-12">
            <JoinSessionCard disabled={loadingSession} onJoined={handleSessionJoined} />
          </section>

          <section className="col-12">
            <SessionList
              title={t('home.recentSessions')}
              isAuthenticated={session.isAuthenticated}
              refreshKey={sessionRefreshKey}
              onSessionSelect={handleSessionSelect}
              limit={2}
            />
          </section>
        </div>
      ) : (
        <section>
          <SessionList
            title={t('home.previousSessions')}
            isAuthenticated={session.isAuthenticated}
            refreshKey={sessionRefreshKey}
            onSessionSelect={handleSessionSelect}
            enablePagination
            pageSize={10}
          />
        </section>
      )}
    </div>
  );
}

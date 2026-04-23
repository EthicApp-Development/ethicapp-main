import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import JoinSessionCard from '../components/JoinSessionCard.jsx';
import SessionList from '../components/SessionList.jsx';

const TABS = {
  JOIN: 'join-session',
  PREVIOUS: 'previous-sessions'
};

export default function HomePage() {
  const navigate = useNavigate();
  const { loadingSession, session, sessionRefreshKey, onSessionJoined } = useOutletContext();
  const [activeTab, setActiveTab] = useState(TABS.JOIN);

  const handleSessionSelect = (sessionId) => {
    navigate(`/sessions/${sessionId}`);
  };

  return (
    <div className="d-flex flex-column gap-4">
      <nav>
        <div className="nav nav-tabs" role="tablist" aria-label="Navegación de sesiones">
          <button
            type="button"
            className={`nav-link ${activeTab === TABS.JOIN ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === TABS.JOIN}
            onClick={() => setActiveTab(TABS.JOIN)}
          >
            Ingresar a Sesión
          </button>
          <button
            type="button"
            className={`nav-link ${activeTab === TABS.PREVIOUS ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === TABS.PREVIOUS}
            onClick={() => setActiveTab(TABS.PREVIOUS)}
          >
            Sesiones Anteriores
          </button>
        </div>
      </nav>

      {activeTab === TABS.JOIN ? (
        <div className="row g-4">
          <section className="col-12">
            <JoinSessionCard disabled={loadingSession} onJoined={onSessionJoined} />
          </section>

          <section className="col-12">
            <SessionList
              title="Sesiones recientes"
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
            title="Sesiones anteriores"
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

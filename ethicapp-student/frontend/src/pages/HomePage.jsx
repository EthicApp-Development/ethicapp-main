import { useNavigate, useOutletContext } from 'react-router-dom';
import JoinSessionCard from '../components/JoinSessionCard.jsx';
import SessionList from '../components/SessionList.jsx';

export default function HomePage() {
  const navigate = useNavigate();
  const { loadingSession, session, sessionRefreshKey, onSessionJoined } = useOutletContext();

  const handleSessionSelect = (sessionId) => {
    navigate(`/sessions/${sessionId}`);
  };

  return (
    <div className="row g-4">
      <section className="col-12 col-xl-5">
        <JoinSessionCard disabled={loadingSession} onJoined={onSessionJoined} />
      </section>

      <section className="col-12 col-xl-7">
        <SessionList
          isAuthenticated={session.isAuthenticated}
          refreshKey={sessionRefreshKey}
          onSessionSelect={handleSessionSelect}
        />
      </section>
    </div>
  );
}

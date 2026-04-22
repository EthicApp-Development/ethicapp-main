import { useEffect, useMemo, useState } from 'react';
import JoinSessionCard from './components/JoinSessionCard.jsx';
import SessionList from './components/SessionList.jsx';
import StudentTopbar from './components/StudentTopbar.jsx';

const SESSION_PLACEHOLDER = {
  isAuthenticated: false,
  uid: null,
  role: null
};

export default function App() {
  const [session, setSession] = useState(SESSION_PLACEHOLDER);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);

  const userDisplayName = useMemo(() => {
    if (!session.isAuthenticated) {
      return 'Estudiante';
    }

    return `Usuario #${session.uid}`;
  }, [session]);

  useEffect(() => {
    fetch('/student/api/session', { credentials: 'include' })
      .then((response) => response.json())
      .then((data) => {
        setSession(data);
        setLoadingSession(false);
      })
      .catch(() => {
        setSession(SESSION_PLACEHOLDER);
        setLoadingSession(false);
      });
  }, []);

  const handleLogout = () => {
    window.location.assign('/logout');
  };

  const handleSessionJoined = () => {
    setSessionRefreshKey((currentKey) => currentKey + 1);
  };

  return (
    <div className="d-flex flex-column min-vh-100 bg-body-tertiary">
      <StudentTopbar loadingSession={loadingSession} userDisplayName={userDisplayName} onLogout={handleLogout} />

      <main className="container py-4 py-md-5 flex-grow-1">
        <div className="row g-4">
          <section className="col-12 col-xl-7">
            <SessionList isAuthenticated={session.isAuthenticated} refreshKey={sessionRefreshKey} />
          </section>

          <section className="col-12 col-xl-5">
            <JoinSessionCard disabled={loadingSession} onJoined={handleSessionJoined} />
          </section>
        </div>
      </main>
    </div>
  );
}

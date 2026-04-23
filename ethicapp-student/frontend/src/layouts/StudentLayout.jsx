import { useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { studentApi } from '../api/studentApi.js';
import StudentTopbar from '../components/StudentTopbar.jsx';
import { useStudentUser } from '../context/StudentUserContext.jsx';

const SESSION_PLACEHOLDER = {
  isAuthenticated: false,
  uid: null,
  role: null
};

export default function StudentLayout() {
  const [session, setSession] = useState(SESSION_PLACEHOLDER);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const { user, loadingUser, refreshUser, clearUser } = useStudentUser();

  const userDisplayName = useMemo(() => {
    if (!session.isAuthenticated) {
      return 'Estudiante';
    }

    const fullName = [user.firstname, user.lastname].filter(Boolean).join(' ').trim();

    if (fullName) {
      return fullName;
    }

    if (user.name) {
      return user.name;
    }

    return `Usuario #${session.uid}`;
  }, [session, user]);

  useEffect(() => {
    studentApi
      .get('session')
      .then(({ data }) => {
        setSession(data);
        if (data?.isAuthenticated) {
          refreshUser();
        } else {
          clearUser();
        }
        setLoadingSession(false);
      })
      .catch(() => {
        setSession(SESSION_PLACEHOLDER);
        clearUser();
        setLoadingSession(false);
      });
  }, [clearUser, refreshUser]);

  const handleLogout = () => {
    window.location.assign('/logout');
  };

  const handleSessionJoined = () => {
    setSessionRefreshKey((currentKey) => currentKey + 1);
  };

  return (
    <div className="d-flex flex-column min-vh-100 bg-body-tertiary">
      <StudentTopbar
        loadingSession={loadingSession || loadingUser}
        userDisplayName={userDisplayName}
        onLogout={handleLogout}
      />

      <main className="container py-4 py-md-5 flex-grow-1">
        <Outlet
          context={{
            loadingSession,
            session,
            sessionRefreshKey,
            onSessionJoined: handleSessionJoined
          }}
        />
      </main>
    </div>
  );
}

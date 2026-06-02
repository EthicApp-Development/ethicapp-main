import { useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useI18n } from '../app/providers.jsx';
import { studentApi } from '../api/studentApi.js';
import StudentTopbar from '../components/StudentTopbar.jsx';
import { useStudentUser } from '../context/StudentUserContext.jsx';

const SESSION_PLACEHOLDER = {
  isAuthenticated: false,
  uid: null,
  role: null
};

export default function StudentLayout() {
  const { t } = useI18n();
  const [session, setSession] = useState(SESSION_PLACEHOLDER);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const { user, loadingUser, refreshUser, clearUser } = useStudentUser();

  const userDisplayName = useMemo(() => {
    if (!session.isAuthenticated) {
      return t('common.studentLabel');
    }

    const fullName = [user.firstname, user.lastname].filter(Boolean).join(' ').trim();

    if (fullName) {
      return fullName;
    }

    if (user.name) {
      return user.name;
    }

    return `${t('common.studentLabel')} #${session.uid}`;
  }, [session, t, user]);

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
    <div className="student-app-shell d-flex flex-column min-vh-100">
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

import { useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useI18n } from '../app/providers.jsx';
import { API_ERROR_KINDS, classifyApiError, describeApiError } from '../api/apiErrors.js';
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
  const [sessionCheckError, setSessionCheckError] = useState('');
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
      .catch((error) => {
        setSession(SESSION_PLACEHOLDER);
        clearUser();
        setLoadingSession(false);

        // An expired session is handled by the expiry notice and redirect.
        if (classifyApiError(error).kind !== API_ERROR_KINDS.EXPIRED) {
          setSessionCheckError(describeApiError(error, t, { fallbackKey: 'apiErrors.unavailable' }));
        }
      });
  }, [clearUser, refreshUser, t]);

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
        {sessionCheckError ? (
          <div className="alert alert-warning d-flex flex-wrap align-items-center gap-3" role="alert">
            <span>{sessionCheckError}</span>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => window.location.reload()}>
              {t('apiErrors.retry')}
            </button>
          </div>
        ) : (
          <Outlet
            context={{
              loadingSession,
              session,
              sessionRefreshKey,
              onSessionJoined: handleSessionJoined
            }}
          />
        )}
      </main>
    </div>
  );
}

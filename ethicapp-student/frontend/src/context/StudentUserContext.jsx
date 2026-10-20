import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { legacyUserApi } from '../api/studentApi.js';
import { localePreference } from '../i18n/localePreference.js';
import { toStudentUser, USER_PLACEHOLDER } from './studentProfile.js';

const StudentUserContext = createContext(null);

function StudentUserProvider({ children }) {
  const [user, setUser] = useState(USER_PLACEHOLDER);
  const [loadingUser, setLoadingUser] = useState(false);

  const refreshUser = useCallback(async () => {
    setLoadingUser(true);

    try {
      const { data } = await legacyUserApi.get('/users/profile');
      const nextUser = toStudentUser(data);
      setUser(nextUser);
      // The saved account preference replaces the browser language for the whole app.
      localePreference.setAccountLocale(nextUser.preferredLocale);
    } catch (_error) {
      setUser(USER_PLACEHOLDER);
    } finally {
      setLoadingUser(false);
    }
  }, []);

  const clearUser = useCallback(() => {
    setUser(USER_PLACEHOLDER);
    setLoadingUser(false);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loadingUser,
      refreshUser,
      clearUser
    }),
    [user, loadingUser, refreshUser, clearUser]
  );

  return <StudentUserContext.Provider value={value}>{children}</StudentUserContext.Provider>;
}

function useStudentUser() {
  const context = useContext(StudentUserContext);

  if (!context) {
    throw new Error('useStudentUser must be used within StudentUserProvider');
  }

  return context;
}

export { StudentUserProvider, useStudentUser };

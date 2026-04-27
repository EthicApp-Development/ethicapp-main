import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { legacyUserApi } from '../api/studentApi.js';

const StudentUserContext = createContext(null);

const USER_PLACEHOLDER = {
  id: null,
  firstname: '',
  lastname: '',
  name: '',
  email: ''
};

function StudentUserProvider({ children }) {
  const [user, setUser] = useState(USER_PLACEHOLDER);
  const [loadingUser, setLoadingUser] = useState(false);

  const refreshUser = useCallback(async () => {
    setLoadingUser(true);

    try {
      const { data } = await legacyUserApi.get('/users/profile');
      const userData = data?.data ?? USER_PLACEHOLDER;
      setUser({
        id: userData.id ?? null,
        firstname: userData.firstname ?? '',
        lastname: userData.lastname ?? '',
        name: userData.name ?? '',
        email: userData.email ?? ''
      });
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

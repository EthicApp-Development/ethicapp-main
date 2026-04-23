import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import axios from 'axios';
import { legacyUserApi } from '../api/studentApi.js';

const StudentActivityStateContext = createContext(null);

export function StudentActivityStateProvider({ children }) {
  const [stateBySession, setStateBySession] = useState({});
  const [loadingBySession, setLoadingBySession] = useState({});
  const [errorBySession, setErrorBySession] = useState({});

  const loadFullState = useCallback(async ({ sessionId, userId, invalidate = false }) => {
    const parsedSessionId = Number(sessionId);
    const parsedUserId = Number(userId);

    if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
      throw new Error('sessionId inválido');
    }

    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      throw new Error('userId inválido');
    }

    setLoadingBySession((prev) => ({ ...prev, [parsedSessionId]: true }));
    setErrorBySession((prev) => ({ ...prev, [parsedSessionId]: '' }));

    try {
      const { data } = await legacyUserApi.get(
        `/activities/${parsedSessionId}/users/${parsedUserId}/full_state`,
        {
          params: {
            invalidate
          }
        }
      );

      const fullState = data?.state ?? null;

      setStateBySession((prev) => ({ ...prev, [parsedSessionId]: fullState }));
      setLoadingBySession((prev) => ({ ...prev, [parsedSessionId]: false }));

      return fullState;
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data?.error ?? 'No se pudo cargar el estado completo de la actividad')
        : 'No se pudo cargar el estado completo de la actividad';

      setStateBySession((prev) => ({ ...prev, [parsedSessionId]: null }));
      setErrorBySession((prev) => ({ ...prev, [parsedSessionId]: message }));
      setLoadingBySession((prev) => ({ ...prev, [parsedSessionId]: false }));
      throw error;
    }
  }, []);

  const value = useMemo(
    () => ({
      stateBySession,
      loadingBySession,
      errorBySession,
      loadFullState
    }),
    [errorBySession, loadFullState, loadingBySession, stateBySession]
  );

  return <StudentActivityStateContext.Provider value={value}>{children}</StudentActivityStateContext.Provider>;
}

export function useStudentActivityState() {
  const context = useContext(StudentActivityStateContext);

  if (!context) {
    throw new Error('useStudentActivityState debe usarse dentro de StudentActivityStateProvider');
  }

  return context;
}

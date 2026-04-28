import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import axios from 'axios';
import { useI18n } from '../app/providers.jsx';
import { legacyUserApi } from '../api/studentApi.js';

const defaultStudentActivityStateContext = {
  stateBySession: {},
  loadingBySession: {},
  errorBySession: {},
  loadFullState: async () => null,
  loadCurrentPhaseState: async () => null,
  submitActivityResponse: async () => null
};

const StudentActivityStateContext = createContext(defaultStudentActivityStateContext);

export function StudentActivityStateProvider({ children }) {
  const { t } = useI18n();
  const [stateBySession, setStateBySession] = useState({});
  const [loadingBySession, setLoadingBySession] = useState({});
  const [errorBySession, setErrorBySession] = useState({});

  const mergePhaseIntoSessionState = useCallback((previousState, phase) => {
    if (!phase || typeof phase !== 'object') {
      return previousState ?? null;
    }

    const previousPhases = Array.isArray(previousState?.phases) ? previousState.phases : [];
    const nextPhases = previousPhases.filter((existingPhase) => existingPhase?.id !== phase.id);

    nextPhases.push(phase);
    nextPhases.sort((leftPhase, rightPhase) => Number(leftPhase?.number ?? 0) - Number(rightPhase?.number ?? 0));

    return {
      ...(previousState ?? {}),
      phases: nextPhases
    };
  }, []);

  const loadFullState = useCallback(async ({ sessionId, userId, invalidate = false }) => {
    const parsedSessionId = Number(sessionId);
    const parsedUserId = Number(userId);

    if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
      throw new Error(t('errors.invalidSessionId'));
    }

    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      throw new Error(t('errors.invalidUserId'));
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
        ? (error.response?.data?.error ?? t('errors.fullStateFallback'))
        : t('errors.fullStateFallback');

      setStateBySession((prev) => ({ ...prev, [parsedSessionId]: null }));
      setErrorBySession((prev) => ({ ...prev, [parsedSessionId]: message }));
      setLoadingBySession((prev) => ({ ...prev, [parsedSessionId]: false }));
      throw error;
    }
  }, [t]);

  const loadCurrentPhaseState = useCallback(async ({ sessionId, invalidate = false }) => {
    const parsedSessionId = Number(sessionId);

    if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
      throw new Error(t('errors.invalidSessionId'));
    }

    setErrorBySession((prev) => ({ ...prev, [parsedSessionId]: '' }));

    try {
      const { data } = await legacyUserApi.get(`/activities/${parsedSessionId}/current_phase_state`, {
        params: {
          invalidate
        }
      });
      const currentPhaseState = data?.phase ?? null;

      setStateBySession((prev) => ({
        ...prev,
        [parsedSessionId]: mergePhaseIntoSessionState(prev[parsedSessionId], currentPhaseState)
      }));

      return currentPhaseState;
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data?.error ?? t('errors.currentPhaseStateFallback'))
        : t('errors.currentPhaseStateFallback');

      setErrorBySession((prev) => ({ ...prev, [parsedSessionId]: message }));
      throw error;
    }
  }, [mergePhaseIntoSessionState, t]);

  const submitActivityResponse = useCallback(async ({ sessionId, responsePayload }) => {
    const parsedSessionId = Number(sessionId);

    if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
      throw new Error(t('errors.invalidSessionId'));
    }

    if (!responsePayload || typeof responsePayload !== 'object') {
      throw new Error(t('errors.invalidResponsePayload'));
    }

    const parsedQuestionId = Number(responsePayload.questionId);

    if (!Number.isInteger(parsedQuestionId) || parsedQuestionId <= 0) {
      throw new Error(t('errors.invalidQuestionId'));
    }

    const { data } = await legacyUserApi.post(`/activities/${parsedSessionId}/response`, {
      ...responsePayload,
      questionId: parsedQuestionId
    });

    return data;
  }, [t]);

  const value = useMemo(
    () => ({
      stateBySession,
      loadingBySession,
      errorBySession,
      loadFullState,
      loadCurrentPhaseState,
      submitActivityResponse
    }),
    [errorBySession, loadCurrentPhaseState, loadFullState, loadingBySession, stateBySession, submitActivityResponse]
  );

  return <StudentActivityStateContext.Provider value={value}>{children}</StudentActivityStateContext.Provider>;
}

export function useStudentActivityState() {
  const context = useContext(StudentActivityStateContext);

  if (context === defaultStudentActivityStateContext && import.meta.env?.DEV) {
    console.warn('useStudentActivityState is running without StudentActivityStateProvider. Using fallback context.');
  }

  return context;
}

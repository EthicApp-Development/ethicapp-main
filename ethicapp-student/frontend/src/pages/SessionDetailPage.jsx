import axios from 'axios';
import { useEffect, useMemo, useReducer } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { studentApi, legacyUserApi } from '../api/studentApi.js';
import { useI18n } from '../app/providers.jsx';
import ActivityTabsPanel from '../components/session-detail/ActivityTabsPanel.jsx';
import SessionMetadata from '../components/session-detail/SessionMetadata.jsx';
import WaitingStatePanel from '../components/session-detail/WaitingStatePanel.jsx';
import { useStudentActivityState } from '../context/StudentActivityStateContext.jsx';
import { getStudentSocket } from '../services/studentSocket.js';
import {
  initialSessionDetailState,
  normalizeStatusCode,
  SESSION_STATUS,
  sessionDetailReducer
} from './session-detail/sessionDetailState.js';

export default function SessionDetailPage() {
  const { locale, t } = useI18n();
  const { session, sessionRefreshKey } = useOutletContext();
  const { sessionId } = useParams();
  const [localState, dispatch] = useReducer(sessionDetailReducer, initialSessionDetailState);
  const { stateBySession, loadingBySession, errorBySession, loadFullState } = useStudentActivityState();

  useEffect(() => {
    if (!session.isAuthenticated) {
      dispatch({ type: 'SESSIONS_CLEAR' });
      return;
    }

    dispatch({ type: 'SESSIONS_LOAD_START' });

    studentApi
      .get('sessions')
      .then(({ data }) => {
        dispatch({
          type: 'SESSIONS_LOAD_SUCCESS',
          payload: Array.isArray(data) ? data : []
        });
      })
      .catch((error) => {
        const message = axios.isAxiosError(error)
          ? (error.response?.data?.error ?? t('sessionDetail.loadErrorFallback'))
          : t('sessionDetail.loadErrorFallback');

        dispatch({ type: 'SESSIONS_LOAD_ERROR', payload: message });
      });
  }, [session.isAuthenticated, sessionRefreshKey, t]);

  const selectedSession = useMemo(() => {
    const parsedSessionId = Number(sessionId);
    return localState.joinedSessions.find((joinedSession) => joinedSession.id === parsedSessionId) ?? null;
  }, [localState.joinedSessions, sessionId]);

  const selectedSessionId = Number(sessionId);
  const activityState = stateBySession[selectedSessionId] ?? null;
  const loadingActivityState = loadingBySession[selectedSessionId] ?? false;
  const activityStateError = errorBySession[selectedSessionId] ?? '';

  useEffect(() => {
    if (!session.isAuthenticated || !selectedSession) {
      dispatch({ type: 'DESCRIPTOR_CLEAR' });
      return;
    }

    let isUnmounted = false;

    dispatch({ type: 'DESCRIPTOR_LOAD_START' });

    legacyUserApi
      .get(`/activities/${selectedSession.id}/descriptor`)
      .then(({ data }) => {
        if (isUnmounted) {
          return;
        }

        dispatch({ type: 'DESCRIPTOR_LOAD_SUCCESS', payload: data?.descriptor ?? null });
      })
      .catch((error) => {
        if (isUnmounted) {
          return;
        }

        const message = axios.isAxiosError(error)
          ? (error.response?.data?.error ?? t('sessionDetail.descriptorLoadErrorFallback'))
          : t('sessionDetail.descriptorLoadErrorFallback');

        dispatch({ type: 'DESCRIPTOR_LOAD_ERROR', payload: message });
      });

    return () => {
      isUnmounted = true;
    };
  }, [selectedSession, session.isAuthenticated, t]);

  const activityStatusCode = useMemo(() => {
    return normalizeStatusCode(localState.activityDescriptor?.status);
  }, [localState.activityDescriptor]);

  const shouldShowWaitingScreen = activityStatusCode === SESSION_STATUS.initiated;
  const shouldLoadActivityData = activityStatusCode >= SESSION_STATUS.inProgress;

  useEffect(() => {
    if (!session.isAuthenticated || !selectedSession || !session.uid || !shouldLoadActivityData) {
      return;
    }

    loadFullState({
      sessionId: selectedSession.id,
      userId: session.uid
    }).catch(() => {
      // The error is already reflected in the context state.
    });
  }, [loadFullState, selectedSession, session.isAuthenticated, session.uid, shouldLoadActivityData]);

  useEffect(() => {
    if (!session.isAuthenticated || !selectedSession || !shouldLoadActivityData) {
      dispatch({ type: 'CASE_CLEAR' });
      return;
    }

    const designId = Number(localState.activityDescriptor?.designId ?? activityState?.descriptor?.design?.id);

    if (!Number.isInteger(designId) || designId <= 0) {
      dispatch({ type: 'CASE_CLEAR' });
      return;
    }

    let isUnmounted = false;

    dispatch({ type: 'CASE_LOAD_START' });

    legacyUserApi
      .get(`/designs/${designId}/case`)
      .then(({ data }) => {
        const caseId = Number(data?.result?.id);

        if (!Number.isInteger(caseId) || caseId <= 0) {
          return { data: { result: null } };
        }

        return legacyUserApi.get(`/cases/${caseId}/download-link`);
      })
      .then(({ data }) => {
        if (isUnmounted) {
          return;
        }

        const url = data?.result?.downloadUrl;
        dispatch({
          type: 'CASE_LOAD_SUCCESS',
          payload: typeof url === 'string' ? url : ''
        });
      })
      .catch((error) => {
        if (isUnmounted) {
          return;
        }

        const message = axios.isAxiosError(error)
          ? (error.response?.data?.message ?? t('sessionDetail.caseLoadErrorFallback'))
          : t('sessionDetail.caseLoadErrorFallback');

        dispatch({ type: 'CASE_LOAD_ERROR', payload: message });
      });

    return () => {
      isUnmounted = true;
    };
  }, [activityState, localState.activityDescriptor?.designId, selectedSession, session.isAuthenticated, shouldLoadActivityData, t]);

  useEffect(() => {
    if (!session.isAuthenticated || !selectedSession) {
      return;
    }

    let isUnmounted = false;
    let socket = null;
    const activeSessionId = Number(selectedSession.id);

    const handlePhaseTransition = (...payload) => {
      console.debug('[student socket] onPhaseTransition', {
        sessionId: activeSessionId,
        payload
      });

      dispatch({ type: 'ACTIVITY_FORCE_IN_PROGRESS' });
    };

    const handleShareResponse = (payload) => {
      console.debug('[student socket] onShareResponse', {
        sessionId: activeSessionId,
        payload
      });
    };

    const handleEndSession = (payload) => {
      console.debug('[student socket] onEndSession', {
        sessionId: activeSessionId,
        payload
      });
    };

    const handleChatMessage = (payload) => {
      console.debug('[student socket] onChatMessage', {
        sessionId: activeSessionId,
        payload
      });
    };

    getStudentSocket()
      .then((instance) => {
        if (isUnmounted) {
          return;
        }

        socket = instance;
        socket.emit('joinSession', activeSessionId);
        socket.on('onPhaseTransition', handlePhaseTransition);
        socket.on('onShareResponse', handleShareResponse);
        socket.on('onEndSession', handleEndSession);
        socket.on('onChatMessage', handleChatMessage);
      })
      .catch((error) => {
        console.debug('[student socket] could not initialize websocket client', {
          sessionId: activeSessionId,
          error
        });
      });

    return () => {
      isUnmounted = true;

      if (!socket) {
        return;
      }

      socket.emit('leaveSession', activeSessionId);
      socket.off('onPhaseTransition', handlePhaseTransition);
      socket.off('onShareResponse', handleShareResponse);
      socket.off('onEndSession', handleEndSession);
      socket.off('onChatMessage', handleChatMessage);
    };
  }, [selectedSession, session.isAuthenticated]);

  const phaseTabs = useMemo(() => {
    return Array.isArray(activityState?.phases) ? activityState.phases : [];
  }, [activityState]);

  const currentPhaseNumber = activityState?.descriptor?.currentPhaseNumber ?? null;
  const currentPhaseId = activityState?.descriptor?.currentPhaseId ?? null;
  const hasCaseTab = localState.caseDocumentUrl.trim().length > 0;

  const tabEntries = useMemo(() => {
    const entries = [];

    if (hasCaseTab) {
      entries.push({ id: 'case', label: t('sessionDetail.caseTab') });
    }

    phaseTabs.forEach((phase) => {
      entries.push({
        id: `phase-${phase.id ?? phase.number}`,
        label: `${t('sessionDetail.phaseN')} ${phase.number}`
      });
    });

    return entries;
  }, [hasCaseTab, phaseTabs, t]);

  useEffect(() => {
    if (tabEntries.length === 0) {
      dispatch({ type: 'ACTIVE_TAB_SET', payload: '' });
      return;
    }

    const activeTabExists = tabEntries.some((tabEntry) => tabEntry.id === localState.activeTab);
    if (activeTabExists) {
      return;
    }

    const nextDefaultTab = hasCaseTab ? 'case' : tabEntries[0].id;
    dispatch({ type: 'ACTIVE_TAB_SET', payload: nextDefaultTab });
  }, [hasCaseTab, localState.activeTab, tabEntries]);

  return (
    <section className="mx-auto" style={{ maxWidth: '860px' }}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 mb-0">{t('sessionDetail.title')}</h1>
        <Link to="/" className="btn btn-outline-secondary btn-sm">
          <span className="d-inline-flex align-items-center gap-2">
            <i className="fa-solid fa-arrow-left" aria-hidden="true" />
            <span>{t('sessionDetail.backHome')}</span>
          </span>
        </Link>
      </div>

      {!session.isAuthenticated ? <p className="text-muted">{t('sessionDetail.loginToView')}</p> : null}
      {localState.loadingSessions ? <p className="text-muted">{t('sessionDetail.loadingDetail')}</p> : null}

      {localState.sessionsError ? (
        <div className="alert alert-danger" role="alert">
          {localState.sessionsError}
        </div>
      ) : null}

      {!localState.loadingSessions && !localState.sessionsError && session.isAuthenticated ? (
        selectedSession ? (
          <article className="card shadow-sm">
            <div className="card-body">
              <SessionMetadata
                selectedSession={selectedSession}
                locale={locale}
                t={t}
                currentPhaseNumber={currentPhaseNumber}
                currentPhaseId={currentPhaseId}
              />

              {localState.loadingDescriptor ? <p className="text-muted mt-3 mb-0">{t('sessionDetail.loadingDescriptor')}</p> : null}

              {localState.descriptorError ? (
                <div className="alert alert-warning mt-3 mb-0" role="alert">
                  {localState.descriptorError}
                </div>
              ) : null}

              {shouldShowWaitingScreen ? <WaitingStatePanel t={t} /> : null}

              {loadingActivityState ? <p className="text-muted mt-3 mb-0">{t('sessionDetail.loadingActivityState')}</p> : null}

              {activityStateError ? (
                <div className="alert alert-warning mt-3 mb-0" role="alert">
                  {activityStateError}
                </div>
              ) : null}

              {localState.loadingCaseDocument ? <p className="text-muted mt-3 mb-0">{t('sessionDetail.loadingCaseDocument')}</p> : null}

              {localState.caseDocumentError ? (
                <div className="alert alert-warning mt-3 mb-0" role="alert">
                  {localState.caseDocumentError}
                </div>
              ) : null}

              {!shouldShowWaitingScreen && !loadingActivityState && !activityStateError && tabEntries.length > 0 ? (
                <ActivityTabsPanel
                  tabEntries={tabEntries}
                  activeTab={localState.activeTab}
                  setActiveTab={(nextTab) => dispatch({ type: 'ACTIVE_TAB_SET', payload: nextTab })}
                  hasCaseTab={hasCaseTab}
                  caseDocumentUrl={localState.caseDocumentUrl}
                  t={t}
                />
              ) : null}
            </div>
          </article>
        ) : (
          <div className="alert alert-warning mb-0" role="alert">
            {t('sessionDetail.notFoundInAvailable')}
          </div>
        )
      ) : null}
    </section>
  );
}

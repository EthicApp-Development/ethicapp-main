import axios from 'axios';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { studentApi, legacyUserApi } from '../api/studentApi.js';
import { useI18n } from '../app/providers.jsx';
import ActivityTabsPanel from '../components/session-detail/ActivityTabsPanel.jsx';
import ExternalServiceResultPanel from '../components/session-detail/external-services/ExternalServiceResultPanel.jsx';
import SessionMetadata from '../components/session-detail/SessionMetadata.jsx';
import WaitingStatePanel from '../components/session-detail/WaitingStatePanel.jsx';
import { useStudentActivityState } from '../context/StudentActivityStateContext.jsx';
import { useActivityRealtimeSync } from './session-detail/hooks/useActivityRealtimeSync.js';
import { usePhaseResponseSubmission } from './session-detail/hooks/usePhaseResponseSubmission.js';
import {
  initialSessionDetailState,
  normalizeStatusCode,
  SESSION_STATUS,
  sessionDetailReducer
} from './session-detail/sessionDetailState.js';

function getCaseDocumentUrl(caseDocument) {
  if (!caseDocument) {
    return '';
  }

  const contentRepresentation = Array.isArray(caseDocument.representations)
    ? caseDocument.representations.find((representation) => representation.rel === 'content')
    : null;

  return contentRepresentation?.href || caseDocument.pdfPath || '';
}

function isCaseDocumentProcessingActive(caseDocument) {
  const status = caseDocument?.documentProcessing?.status;
  return status === 'pending' || status === 'processing';
}

export default function ActivityPage() {
  const { locale, t } = useI18n();
  const { session, sessionRefreshKey } = useOutletContext();
  const { sessionId } = useParams();
  const [localState, dispatch] = useReducer(sessionDetailReducer, initialSessionDetailState);
  const [chatRefreshTokenByPhaseId, setChatRefreshTokenByPhaseId] = useState({});
  const [externalServiceResults, setExternalServiceResults] = useState([]);
  const [groupIdByPhaseId, setGroupIdByPhaseId] = useState({});
  const [groupContextByPhaseId, setGroupContextByPhaseId] = useState({});
  const [atsPendingByPhaseId, setAtsPendingByPhaseId] = useState({});
  const lastAutoSelectedPhaseIdRef = useRef(null);
  const currentGroupIdRef = useRef(null);
  const currentPhaseIdRef = useRef(null);
  const {
    stateBySession,
    loadingBySession,
    errorBySession,
    loadFullState,
    loadCurrentPhaseState,
    submitActivityResponse
  } = useStudentActivityState();

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
    const phaseId = Number(activityState?.descriptor?.currentPhaseId);

    if (!Number.isInteger(phaseId) || phaseId <= 0) {
      currentPhaseIdRef.current = null;
      return;
    }

    currentPhaseIdRef.current = phaseId;
  }, [activityState?.descriptor?.currentPhaseId]);

  useEffect(() => {
    lastAutoSelectedPhaseIdRef.current = null;
  }, [selectedSessionId]);

  useEffect(() => {
    setAtsPendingByPhaseId({});
  }, [selectedSessionId]);

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
  const isSessionFinished = activityStatusCode === SESSION_STATUS.finished;

  const handleExternalServiceResult = useCallback((payload) => {
    const serviceId = String(payload?.serviceId || '').trim();
    const payloadPhaseId = Number(payload?.phaseId);
    if (serviceId === 'argumentation-tutor-system' && Number.isInteger(payloadPhaseId) && payloadPhaseId > 0) {
      setAtsPendingByPhaseId((previous) => {
        const current = Number(previous[payloadPhaseId]) || 0;
        return {
          ...previous,
          [payloadPhaseId]: Math.max(0, current - 1)
        };
      });
    }

    setExternalServiceResults((previousResults) => [
      {
        id: payload?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ...payload
      },
      ...previousResults
    ].slice(0, 10));
  }, []);

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

        return legacyUserApi.get(`/cases/${caseId}`);
      })
      .then(({ data }) => {
        if (isUnmounted) {
          return;
        }

        const caseDocument = data?.result ?? null;
        dispatch({
          type: 'CASE_LOAD_SUCCESS',
          payload: {
            caseDocument,
            caseDocumentUrl: getCaseDocumentUrl(caseDocument)
          }
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
    const caseId = Number(localState.caseDocument?.id);
    if (!Number.isInteger(caseId) || caseId <= 0 || !isCaseDocumentProcessingActive(localState.caseDocument)) {
      return undefined;
    }

    let isCancelled = false;

    const intervalId = window.setInterval(() => {
      legacyUserApi
        .get(`/cases/${caseId}`)
        .then(({ data }) => {
          if (isCancelled) {
            return;
          }

          const caseDocument = data?.result ?? null;
          dispatch({
            type: 'CASE_LOAD_SUCCESS',
            payload: {
              caseDocument,
              caseDocumentUrl: getCaseDocumentUrl(caseDocument)
            }
          });
        })
        .catch(() => {
          // Keep the last successfully loaded case document visible.
        });
    }, 5000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [localState.caseDocument]);

  useActivityRealtimeSync({
    session,
    selectedSession,
    currentPhaseIdRef,
    currentGroupIdRef,
    loadCurrentPhaseState,
    loadFullState,
    dispatch,
    setChatRefreshTokenByPhaseId,
    activityCurrentPhaseId: activityState?.descriptor?.currentPhaseId,
    setGroupIdByPhaseId,
    setGroupContextByPhaseId,
    onExternalServiceResult: handleExternalServiceResult
  });

  const phaseTabs = useMemo(() => {
    const phases = Array.isArray(activityState?.phases) ? activityState.phases : [];

    return phases.map((phase) => {
      const phaseId = Number(phase?.id);
      const groupId = groupIdByPhaseId[phaseId];

      if (!Number.isInteger(groupId) || groupId <= 0) {
        return phase;
      }

      const groupContext = groupContextByPhaseId[phaseId];

      return {
        ...phase,
        groupId,
        groupParticipants: Array.isArray(groupContext?.participants) ? groupContext.participants : [],
        groupAnonymous: typeof groupContext?.phaseAnonymous === 'boolean' ? groupContext.phaseAnonymous : undefined
      };
    });
  }, [activityState, groupContextByPhaseId, groupIdByPhaseId]);

  const atsEnabledByPhaseId = useMemo(() => {
    const design = activityState?.descriptor?.design || localState.activityDescriptor?.design;
    const designPhases = Array.isArray(design?.phases) ? design.phases : [];
    const enabledByPhaseId = {};

    phaseTabs.forEach((phase) => {
      const phaseId = Number(phase?.id);
      const phaseNumber = Number(phase?.number);
      if (!Number.isInteger(phaseId) || phaseId <= 0 || !Number.isInteger(phaseNumber) || phaseNumber <= 0) {
        return;
      }

      const phaseDesign = designPhases[phaseNumber - 1];
      const enabledServiceIds = Array.isArray(phaseDesign?.externalServices?.enabledServiceIds)
        ? phaseDesign.externalServices.enabledServiceIds
        : [];

      enabledByPhaseId[phaseId] = enabledServiceIds.includes('argumentation-tutor-system');
    });

    return enabledByPhaseId;
  }, [activityState?.descriptor?.design, localState.activityDescriptor?.design, phaseTabs]);

  const atsProcessingByPhaseId = useMemo(() => {
    const processingByPhaseId = {};
    Object.entries(atsPendingByPhaseId).forEach(([phaseIdRaw, pendingCount]) => {
      const phaseId = Number(phaseIdRaw);
      if (!Number.isInteger(phaseId) || phaseId <= 0) {
        return;
      }

      processingByPhaseId[phaseId] = Number(pendingCount) > 0;
    });

    return processingByPhaseId;
  }, [atsPendingByPhaseId]);

  const currentPhaseNumber = activityState?.descriptor?.currentPhaseNumber ?? null;
  const currentPhaseId = activityState?.descriptor?.currentPhaseId ?? null;
  const designType = activityState?.descriptor?.design?.type ?? localState.activityDescriptor?.design?.type ?? '';
  const hasCaseTab = localState.caseDocumentUrl.trim().length > 0 || Boolean(localState.caseDocument);

  const tabEntries = useMemo(() => {
    const entries = [];

    if (hasCaseTab) {
      entries.push({
        id: 'case',
        label: t('sessionDetail.caseTab'),
        iconClass: 'fa-book',
        iconStyle: 'solid'
      });
    }

    const phaseIconClassByDesign = {
      semantic_differential: { iconClass: 'fa-file', iconStyle: 'regular' },
      ranking: { iconClass: 'fa-puzzle-piece', iconStyle: 'solid' }
    };
    const phaseIconConfig = phaseIconClassByDesign[designType] ?? { iconClass: 'fa-puzzle-piece', iconStyle: 'solid' };

    phaseTabs.forEach((phase) => {
      entries.push({
        id: `phase-${phase.id ?? phase.number}`,
        label: `${t('sessionDetail.phaseN')} ${phase.number}`,
        iconClass: phaseIconConfig.iconClass,
        iconStyle: phaseIconConfig.iconStyle
      });
    });

    return entries;
  }, [designType, hasCaseTab, phaseTabs, t]);

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

  useEffect(() => {
    if (!currentPhaseId || isSessionFinished) {
      return;
    }

    if (lastAutoSelectedPhaseIdRef.current === currentPhaseId) {
      return;
    }

    lastAutoSelectedPhaseIdRef.current = currentPhaseId;
    const currentPhaseTabId = `phase-${currentPhaseId}`;
    if (localState.activeTab !== currentPhaseTabId) {
      dispatch({ type: 'ACTIVE_TAB_SET', payload: currentPhaseTabId });
    }
  }, [currentPhaseId, isSessionFinished, localState.activeTab]);

  const { onSubmitPhaseResponse } = usePhaseResponseSubmission({
    t,
    selectedSessionId,
    submitActivityResponse,
    loadFullState,
    userId: session.uid,
    onResponseAccepted: ({ responsePayload }) => {
      const phaseId = Number(responsePayload?.phaseId);
      if (!Number.isInteger(phaseId) || phaseId <= 0) {
        return;
      }

      if (!atsEnabledByPhaseId[phaseId]) {
        return;
      }

      setAtsPendingByPhaseId((previous) => ({
        ...previous,
        [phaseId]: (Number(previous[phaseId]) || 0) + 1
      }));
    }
  });

  return (
    <section className="mx-auto" style={{ maxWidth: '860px' }}>
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
            <div className="card-header bg-white d-flex justify-content-between align-items-start gap-3 flex-wrap">
              <div>
                <h1 className="h4 mb-2">{selectedSession.name ?? `${t('sessions.sessionFallbackName')} #${selectedSession.id}`}</h1>
                <p className="text-secondary mb-0">{selectedSession.descr || t('sessionDetail.noDescription')}</p>
              </div>
              <Link to="/" className="btn btn-outline-secondary btn-sm">
                <span className="d-inline-flex align-items-center gap-2">
                  <i className="fa-solid fa-arrow-left" aria-hidden="true" />
                  <span>{t('sessionDetail.backHome')}</span>
                </span>
              </Link>
            </div>
            <div className="card-body">
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

              {!shouldShowWaitingScreen && !activityStateError && tabEntries.length > 0 ? (
                <>
                  {isSessionFinished ? (
                    <div className="alert alert-warning mt-3 mb-0" role="alert">
                      {t('sessionDetail.activityFinished')}
                    </div>
                  ) : null}
                  <ActivityTabsPanel
                    tabEntries={tabEntries}
                    activeTab={localState.activeTab}
                    setActiveTab={(nextTab) => dispatch({ type: 'ACTIVE_TAB_SET', payload: nextTab })}
                    hasCaseTab={hasCaseTab}
                    caseDocument={localState.caseDocument}
                    caseDocumentUrl={localState.caseDocumentUrl}
                    t={t}
                    phases={phaseTabs}
                    currentPhaseId={currentPhaseId}
                    designType={designType}
                    isSessionFinished={isSessionFinished}
                    onSubmitPhaseResponse={onSubmitPhaseResponse}
                    chatRefreshTokenByPhaseId={chatRefreshTokenByPhaseId}
                    atsEnabledByPhaseId={atsEnabledByPhaseId}
                    atsProcessingByPhaseId={atsProcessingByPhaseId}
                    userId={session.uid}
                  />
                  <ExternalServiceResultPanel
                    results={externalServiceResults}
                    t={t}
                    onDismiss={(resultId) => {
                      setExternalServiceResults((previousResults) => {
                        return previousResults.filter((result) => result.id !== resultId);
                      });
                    }}
                  />
                </>
              ) : null}
            </div>
          </article>
        ) : (
          <div className="alert alert-warning mb-0" role="alert">
            {t('sessionDetail.notFoundInAvailable')}
          </div>
        )
      ) : null}

      {selectedSession ? (
        <SessionMetadata
          selectedSession={selectedSession}
          locale={locale}
          t={t}
          currentPhaseNumber={currentPhaseNumber}
          currentPhaseId={currentPhaseId}
        />
      ) : null}
    </section>
  );
}

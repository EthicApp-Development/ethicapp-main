import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { describeApiError, withReference } from '../api/apiErrors.js';
import { studentApi, legacyUserApi } from '../api/studentApi.js';
import { fetchStudentExternalResults } from '../api/studentExternalResults.js';
import { useI18n } from '../app/providers.jsx';
import ActivityTabsPanel from '../components/session-detail/ActivityTabsPanel.jsx';
import DeadlineDraftNotice from '../components/session-detail/DeadlineDraftNotice.jsx';
import PhaseTimer from '../components/session-detail/PhaseTimer.jsx';
import SessionMetadata from '../components/session-detail/SessionMetadata.jsx';
import WaitingStatePanel from '../components/session-detail/WaitingStatePanel.jsx';
import { CaseVideosProvider } from '../context/CaseVideosContext.jsx';
import { useStudentActivityState } from '../context/StudentActivityStateContext.jsx';
import { errorLogDetails } from '../utils/logDetails.js';
import { useActivityPhaseTimer } from './session-detail/hooks/useActivityPhaseTimer.js';
import { useActivityRealtimeSync } from './session-detail/hooks/useActivityRealtimeSync.js';
import { useChatPhaseGroups } from './session-detail/hooks/useChatPhaseGroups.js';
import { useDeadlineDraftSender } from './session-detail/hooks/useDeadlineDraftSender.js';
import { usePhaseDrafts } from './session-detail/hooks/usePhaseDrafts.js';
import { usePhaseResponseSubmission } from './session-detail/hooks/usePhaseResponseSubmission.js';
import {
  EXTERNAL_RESPONSE_PROCESSING_TIMEOUT_MS,
  applyResponseProcessingDelta,
  buildResponseProcessingByPhase,
  buildResponseProcessingServicesByPhase,
  processingResolvedByResults
} from './session-detail/externalResponseProcessing.js';
import {
  defaultExpandedResultKey,
  isExternalResultExpanded,
  toggleExternalResult
} from './session-detail/externalResultsExpansion.js';
import { createExternalResultsLoader } from './session-detail/externalResultsLoading.js';
import { REALTIME_STATUS } from './session-detail/realtimeFallback.js';
import {
  groupExternalResultsByPhase,
  liveExternalResult,
  loadedExternalResults,
  mergeExternalResults,
  unseenExternalResults
} from './session-detail/externalServiceResults.js';
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

function buildResponseProcessingTimeoutKey(phaseId, serviceId) {
  return `${phaseId}:${serviceId}`;
}

function removeQueuedTimeout(timeoutMap, timeoutKey, timeoutId) {
  const queue = timeoutMap.get(timeoutKey) ?? [];
  const nextQueue = queue.filter((queuedTimeoutId) => queuedTimeoutId !== timeoutId);

  if (nextQueue.length > 0) {
    timeoutMap.set(timeoutKey, nextQueue);
  } else {
    timeoutMap.delete(timeoutKey);
  }
}

export default function ActivityPage() {
  const { locale, t } = useI18n();
  const { session, sessionRefreshKey } = useOutletContext();
  const { sessionId } = useParams();
  const [localState, dispatch] = useReducer(sessionDetailReducer, initialSessionDetailState);
  const [chatRefreshTokenByPhaseId, setChatRefreshTokenByPhaseId] = useState({});
  const [externalServiceResults, setExternalServiceResults] = useState([]);
  const [externalResultToggles, setExternalResultToggles] = useState({});
  const [groupIdByPhaseId, setGroupIdByPhaseId] = useState({});
  const [groupContextByPhaseId, setGroupContextByPhaseId] = useState({});
  const [pendingExternalResponseProcessingByPhaseId, setPendingExternalResponseProcessingByPhaseId] = useState({});
  // The "Update activity" action: idle, running, done (held, "up to date")
  // or failed (held for a shorter time).
  const [activityUpdate, setActivityUpdate] = useState('idle');
  const activityUpdateTimerRef = useRef(null);
  const activityStatusCodeRef = useRef(null);
  const lastAutoSelectedPhaseIdRef = useRef(null);
  const currentGroupIdRef = useRef(null);
  const currentPhaseIdRef = useRef(null);
  const responseProcessingTimeoutsByKeyRef = useRef(new Map());
  const responseProcessingServiceIdsByPhaseIdRef = useRef({});
  const shownExternalResultKeysRef = useRef(new Set());
  const showExternalResultsRef = useRef(() => {});
  const {
    stateBySession,
    loadingBySession,
    errorBySession,
    loadFullState,
    loadCurrentPhaseState,
    submitActivityResponse
  } = useStudentActivityState();

  const adjustExternalResponseProcessing = useCallback(({ phaseId, serviceId, delta }) => {
    setPendingExternalResponseProcessingByPhaseId((previous) => (
      applyResponseProcessingDelta(previous, { phaseId, serviceId, delta })
    ));
  }, []);

  const clearExternalResponseProcessingTimeouts = useCallback(() => {
    responseProcessingTimeoutsByKeyRef.current.forEach((timeoutQueue) => {
      timeoutQueue.forEach((timeoutId) => window.clearTimeout(timeoutId));
    });
    responseProcessingTimeoutsByKeyRef.current.clear();
  }, []);

  const beginExternalResponseProcessing = useCallback(({ phaseId, serviceId }) => {
    const normalizedPhaseId = Number(phaseId);
    const normalizedServiceId = typeof serviceId === 'string' ? serviceId.trim() : '';

    if (!Number.isInteger(normalizedPhaseId) || normalizedPhaseId <= 0 || !normalizedServiceId) {
      return;
    }

    adjustExternalResponseProcessing({
      phaseId: normalizedPhaseId,
      serviceId: normalizedServiceId,
      delta: 1
    });

    const timeoutKey = buildResponseProcessingTimeoutKey(normalizedPhaseId, normalizedServiceId);
    const timeoutId = window.setTimeout(() => {
      removeQueuedTimeout(responseProcessingTimeoutsByKeyRef.current, timeoutKey, timeoutId);
      adjustExternalResponseProcessing({
        phaseId: normalizedPhaseId,
        serviceId: normalizedServiceId,
        delta: -1
      });
    }, EXTERNAL_RESPONSE_PROCESSING_TIMEOUT_MS);

    const timeoutQueue = responseProcessingTimeoutsByKeyRef.current.get(timeoutKey) ?? [];
    responseProcessingTimeoutsByKeyRef.current.set(timeoutKey, [...timeoutQueue, timeoutId]);
  }, [adjustExternalResponseProcessing]);

  const resolveExternalResponseProcessing = useCallback(({ phaseId, serviceId }) => {
    const normalizedPhaseId = Number(phaseId);
    const normalizedServiceId = typeof serviceId === 'string' ? serviceId.trim() : '';

    if (!Number.isInteger(normalizedPhaseId) || normalizedPhaseId <= 0 || !normalizedServiceId) {
      return;
    }

    const timeoutKey = buildResponseProcessingTimeoutKey(normalizedPhaseId, normalizedServiceId);
    const timeoutQueue = responseProcessingTimeoutsByKeyRef.current.get(timeoutKey) ?? [];
    const timeoutId = timeoutQueue[0];

    if (timeoutId) {
      window.clearTimeout(timeoutId);
      removeQueuedTimeout(responseProcessingTimeoutsByKeyRef.current, timeoutKey, timeoutId);
    }

    adjustExternalResponseProcessing({
      phaseId: normalizedPhaseId,
      serviceId: normalizedServiceId,
      delta: -1
    });
  }, [adjustExternalResponseProcessing]);

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
        dispatch({
          type: 'SESSIONS_LOAD_ERROR',
          payload: describeApiError(error, t, { fallbackKey: 'sessionDetail.loadErrorFallback' })
        });
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
    clearExternalResponseProcessingTimeouts();
    setPendingExternalResponseProcessingByPhaseId({});
  }, [clearExternalResponseProcessingTimeouts, selectedSessionId]);

  useEffect(() => {
    return () => {
      clearExternalResponseProcessingTimeouts();
    };
  }, [clearExternalResponseProcessingTimeouts]);

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

        dispatch({
          type: 'DESCRIPTOR_LOAD_ERROR',
          payload: describeApiError(error, t, { fallbackKey: 'sessionDetail.descriptorLoadErrorFallback' })
        });
      });

    return () => {
      isUnmounted = true;
    };
  }, [selectedSession, session.isAuthenticated, t]);

  const activityStatusCode = useMemo(() => {
    return normalizeStatusCode(localState.activityDescriptor?.status);
  }, [localState.activityDescriptor]);

  useEffect(() => {
    activityStatusCodeRef.current = activityStatusCode;
  }, [activityStatusCode]);

  const shouldShowWaitingScreen = activityStatusCode === SESSION_STATUS.initiated;
  const shouldLoadActivityData = activityStatusCode >= SESSION_STATUS.inProgress;
  const isSessionFinished = activityStatusCode === SESSION_STATUS.finished;

  // Shows results from either source once each, by result key. A result not
  // shown before ends its response's processing state, whichever source
  // brought it first.
  const showExternalResults = useCallback((entries) => {
    const unseen = unseenExternalResults(shownExternalResultKeysRef.current, entries);

    unseen.forEach((entry) => shownExternalResultKeysRef.current.add(entry.key));
    processingResolvedByResults(unseen, responseProcessingServiceIdsByPhaseIdRef.current)
      .forEach(resolveExternalResponseProcessing);

    setExternalServiceResults((previousResults) => mergeExternalResults(previousResults, entries));
  }, [resolveExternalResponseProcessing]);

  const handleExternalServiceResult = useCallback((payload) => {
    const entry = liveExternalResult(payload);

    if (entry) {
      showExternalResults([entry]);
    }
  }, [showExternalResults]);

  useEffect(() => {
    showExternalResultsRef.current = showExternalResults;
  }, [showExternalResults]);

  // Loads the results published to the student when the activity opens,
  // after a phase transition, once the socket has joined the student's room
  // and after a socket reconnect. Only the answer
  // of the latest load applied is kept, and a failed load leaves the shown
  // results as they are.
  const [externalResultsLoader] = useState(() => createExternalResultsLoader({
    fetchResults: (target) => fetchStudentExternalResults(legacyUserApi, target),
    applyResults: (results) => showExternalResultsRef.current(loadedExternalResults(results)),
    reportFailure: (error, target) => {
      // Ids, and the error's name, code and status: an answer can quote the
      // student (#1139).
      console.debug('[student] could not load external service results', {
        sessionId: target.sessionId,
        ...errorLogDetails(error)
      });
    }
  }));

  // Another activity starts from nothing.
  useEffect(() => {
    shownExternalResultKeysRef.current = new Set();
    setExternalServiceResults([]);
    setExternalResultToggles({});
  }, [selectedSessionId]);

  const resultsSessionId = Number(selectedSession?.id) || null;
  const resultsUserId = Number(session.uid) || null;
  const canLoadExternalResults = Boolean(
    session.isAuthenticated && resultsSessionId && resultsUserId && shouldLoadActivityData
  );

  useEffect(() => {
    externalResultsLoader.open(
      canLoadExternalResults ? { sessionId: resultsSessionId, userId: resultsUserId } : null
    );
  }, [canLoadExternalResults, externalResultsLoader, resultsSessionId, resultsUserId]);

  useEffect(() => {
    externalResultsLoader.phaseChanged({
      sessionId: selectedSessionId,
      phaseId: activityState?.descriptor?.currentPhaseId
    });
  }, [activityState?.descriptor?.currentPhaseId, externalResultsLoader, selectedSessionId]);

  const externalResultsByPhaseId = useMemo(() => (
    groupExternalResultsByPhase(externalServiceResults)
  ), [externalServiceResults]);

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

        dispatch({
          type: 'CASE_LOAD_ERROR',
          payload: describeApiError(error, t, {
            fallbackKey: 'sessionDetail.caseLoadErrorFallback',
            bodyField: 'message'
          })
        });
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

  // Reloads what a phase transition or the end of the activity changes: the
  // activity's status and, once it started, its state. `invalidate` flushes
  // the server's caches, as the socket's onPhaseTransition handler does; the
  // caller asks for it only when the activity changed or may have, since
  // those caches are shared by the session's students (#626).
  const refreshActivity = useCallback(async ({ invalidate = true } = {}) => {
    const activeSessionId = Number(selectedSession?.id);
    if (!Number.isInteger(activeSessionId) || activeSessionId <= 0) return;

    const { data } = await legacyUserApi.get(`/activities/${activeSessionId}/descriptor`);
    const descriptor = data?.descriptor ?? null;
    dispatch({ type: 'DESCRIPTOR_LOAD_SUCCESS', payload: descriptor });

    const status = normalizeStatusCode(descriptor?.status);
    if (status === SESSION_STATUS.inProgress) {
      loadCurrentPhaseState({ sessionId: activeSessionId, invalidate }).catch(() => {});
    }
    if (status >= SESSION_STATUS.inProgress) {
      await loadFullState({ sessionId: activeSessionId, userId: session.uid, invalidate });
    }
  }, [loadCurrentPhaseState, loadFullState, selectedSession, session.uid]);

  // Whether the activity moved on since the view loaded it, without flushing
  // any cache: its status, then its current phase from the cached full state.
  // The server flushes the cached descriptor when a phase starts or the
  // activity ends, so the cached answer is current (#626).
  const probeActivity = useCallback(async () => {
    const activeSessionId = Number(selectedSession?.id);
    if (!Number.isInteger(activeSessionId) || activeSessionId <= 0) return false;

    const { data } = await legacyUserApi.get(`/activities/${activeSessionId}/descriptor`);
    const status = normalizeStatusCode(data?.descriptor?.status);
    if (status !== activityStatusCodeRef.current) return true;
    if (status !== SESSION_STATUS.inProgress) return false;

    const { data: stateData } = await legacyUserApi.get(
      `/activities/${activeSessionId}/users/${session.uid}/full_state`,
      { params: { invalidate: false } }
    );
    const phaseId = Number(stateData?.state?.descriptor?.currentPhaseId);
    return Number.isInteger(phaseId) && phaseId > 0 && phaseId !== Number(currentPhaseIdRef.current);
  }, [selectedSession, session.uid]);

  const { realtimeIssue, connectionStatus, updateNow } = useActivityRealtimeSync({
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
    onExternalServiceResult: handleExternalServiceResult,
    // Catches up with results published between the opening load and the
    // room's join, however late the first connection is (#1143).
    onUserRoomJoined: externalResultsLoader.subscribed,
    // After a reconnect (after #1108, the socket has rejoined its rooms).
    onReconnect: externalResultsLoader.reconnected,
    refreshActivity,
    probeActivity
  });

  // The "Update activity" action, for views where a browser reload is not
  // at hand, such as an LMS iframe (#626). The button stays disabled while
  // the update runs and while further updates are held, saying the activity
  // is up to date, so repeated clicks cost nothing and the student sees that
  // the update worked.
  const handleUpdateActivity = useCallback(async () => {
    window.clearTimeout(activityUpdateTimerRef.current);
    setActivityUpdate('running');
    const { ok, held, heldUntil } = await updateNow();
    if (ok && !held) externalResultsLoader.reconnected();
    setActivityUpdate(ok ? 'done' : 'failed');
    activityUpdateTimerRef.current = window.setTimeout(
      () => setActivityUpdate('idle'),
      Math.max(0, heldUntil - Date.now())
    );
  }, [externalResultsLoader, updateNow]);

  // Another activity starts without the last one's update outcome.
  useEffect(() => {
    window.clearTimeout(activityUpdateTimerRef.current);
    setActivityUpdate('idle');
  }, [selectedSessionId]);

  useEffect(() => () => window.clearTimeout(activityUpdateTimerRef.current), []);

  // The chat of an earlier phase, or of any phase of a finished activity,
  // opens read-only once the student's group there is known (#1168).
  useChatPhaseGroups({
    session,
    sessionId: selectedSessionId,
    phases: activityState?.phases,
    currentPhaseId: activityState?.descriptor?.currentPhaseId,
    setGroupIdByPhaseId,
    setGroupContextByPhaseId
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

  const responseProcessingServiceIdsByPhaseId = useMemo(() => {
    const design = activityState?.descriptor?.design || localState.activityDescriptor?.design;
    const services = activityState?.descriptor?.externalServices?.services
      ?? localState.activityDescriptor?.externalServices?.services
      ?? [];

    return buildResponseProcessingServicesByPhase({
      phases: phaseTabs,
      design,
      services
    });
  }, [
    activityState?.descriptor?.design,
    activityState?.descriptor?.externalServices?.services,
    localState.activityDescriptor?.design,
    localState.activityDescriptor?.externalServices?.services,
    phaseTabs
  ]);

  useEffect(() => {
    responseProcessingServiceIdsByPhaseIdRef.current = responseProcessingServiceIdsByPhaseId;
  }, [responseProcessingServiceIdsByPhaseId]);

  const externalResponseProcessingByPhaseId = useMemo(() => (
    buildResponseProcessingByPhase(pendingExternalResponseProcessingByPhaseId)
  ), [pendingExternalResponseProcessingByPhaseId]);

  const currentPhaseNumber = activityState?.descriptor?.currentPhaseNumber ?? null;
  const currentPhaseId = activityState?.descriptor?.currentPhaseId ?? null;

  // The current phase's time left (#1117), while the activity is in
  // progress, shown on the case and on the current phase.
  const phaseTimer = useActivityPhaseTimer({
    sessionId: selectedSession?.id,
    enabled: session.isAuthenticated && Boolean(selectedSession) && activityStatusCode === SESSION_STATUS.inProgress,
    currentPhaseId
  });
  const showPhaseTimer = localState.activeTab === 'case'
    || (currentPhaseId !== null && localState.activeTab === `phase-${currentPhaseId}`);

  // The newest result of the current phase is expanded, the others
  // collapsed, until the student toggles them (page state only).
  const defaultExpandedKey = useMemo(() => (
    defaultExpandedResultKey(externalResultsByPhaseId, currentPhaseId)
  ), [currentPhaseId, externalResultsByPhaseId]);

  const expandedExternalResultKeys = useMemo(() => new Set(
    externalServiceResults
      .filter((result) => (
        isExternalResultExpanded(externalResultToggles, result.key, defaultExpandedKey)
      ))
      .map((result) => result.key)
  ), [defaultExpandedKey, externalResultToggles, externalServiceResults]);

  const onToggleExternalResult = useCallback((resultKey) => {
    setExternalResultToggles((previousToggles) => (
      toggleExternalResult(previousToggles, resultKey, defaultExpandedKey)
    ));
  }, [defaultExpandedKey]);

  const designType = activityState?.descriptor?.design?.type ?? localState.activityDescriptor?.design?.type ?? '';

  // The student's unsent answers, kept on the device and sent for them
  // when a hard-mode phase runs out of time (#1118). Only the semantic
  // differential has answers to keep; the ranking view is a placeholder.
  const keepsDrafts = designType === 'semantic_differential';
  const canKeepDrafts = session.isAuthenticated && Boolean(selectedSession) && keepsDrafts && shouldLoadActivityData;
  const { draftsByPhaseId, draftsRef, setTaskDraft } = usePhaseDrafts({
    userId: session.uid,
    sessionId: selectedSession?.id,
    phases: activityState?.phases,
    enabled: canKeepDrafts
  });
  const deadlineDrafts = useDeadlineDraftSender({
    sessionId: selectedSession?.id,
    userId: session.uid,
    canRestore: canKeepDrafts,
    enabled: activityStatusCode === SESSION_STATUS.inProgress,
    timer: phaseTimer,
    phases: activityState?.phases,
    draftsRef,
    submitActivityResponse,
    loadFullState
  });
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

      const processingServiceIds = responseProcessingServiceIdsByPhaseId[phaseId] ?? [];

      if (processingServiceIds.length === 0) {
        return;
      }

      processingServiceIds.forEach((serviceId) => {
        beginExternalResponseProcessing({ phaseId, serviceId });
      });
    }
  });

  // The student's own submit: no answer sent for them starts meanwhile.
  const submitPhaseResponse = (request) => deadlineDrafts.trackManual(
    request?.responsePayload,
    () => onSubmitPhaseResponse(request)
  );

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
              <div className="d-flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`btn btn-sm ${activityUpdate === 'done' ? 'btn-outline-success' : 'btn-outline-primary'}`}
                  onClick={handleUpdateActivity}
                  disabled={activityUpdate !== 'idle'}
                >
                  <span className="d-inline-flex align-items-center gap-2" aria-live="polite">
                    <i
                      className={`fa-solid ${activityUpdate === 'done' ? 'fa-check' : 'fa-rotate'}${activityUpdate === 'running' ? ' fa-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>
                      {t({
                        running: 'sessionDetail.refreshingActivity',
                        done: 'sessionDetail.activityUpToDate'
                      }[activityUpdate] ?? 'sessionDetail.refreshActivity')}
                    </span>
                  </span>
                </button>
                <Link to="/" className="btn btn-outline-secondary btn-sm">
                  <span className="d-inline-flex align-items-center gap-2">
                    <i className="fa-solid fa-arrow-left" aria-hidden="true" />
                    <span>{t('sessionDetail.backHome')}</span>
                  </span>
                </Link>
              </div>
            </div>
            <div className="card-body">
              {/* Shown once the connection has stayed down for a while, so a
                  short reconnect never flashes it (#626). */}
              {connectionStatus === REALTIME_STATUS.DISCONNECTED ? (
                <div className="alert alert-warning py-2 mb-3" role="status">
                  {withReference(t('apiErrors.realtimeUnavailable'), realtimeIssue?.requestId ?? null, t)}
                </div>
              ) : null}

              {activityUpdate === 'failed' && !activityStateError ? (
                <div className="alert alert-warning py-2 mb-3" role="alert">
                  {t('sessionDetail.refreshActivityFailed')}
                </div>
              ) : null}

              {localState.loadingDescriptor ? <p className="text-muted mt-3 mb-0">{t('sessionDetail.loadingDescriptor')}</p> : null}

              {localState.descriptorError ? (
                <div className="alert alert-warning mt-3 mb-0" role="alert">
                  {localState.descriptorError}
                </div>
              ) : null}

              {shouldShowWaitingScreen ? <WaitingStatePanel t={t} /> : null}

              {/* Only the first load says so: a reload keeps the activity in
                  place instead of pushing it down (#626). */}
              {loadingActivityState && !activityState ? <p className="text-muted mt-3 mb-0">{t('sessionDetail.loadingActivityState')}</p> : null}

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
                <CaseVideosProvider videos={localState.caseDocument?.videos}>
                  {isSessionFinished ? (
                    <div className="alert alert-warning mt-3 mb-0" role="alert">
                      {t('sessionDetail.activityFinished')}
                    </div>
                  ) : null}
                  <PhaseTimer timer={phaseTimer} visible={showPhaseTimer} t={t} />
                  <DeadlineDraftNotice
                    notice={deadlineDrafts.notice}
                    phaseOpen={
                      !isSessionFinished
                      && deadlineDrafts.notice !== null
                      && Number(deadlineDrafts.notice.phaseId) === Number(currentPhaseId)
                    }
                    onDismiss={deadlineDrafts.dismissNotice}
                    t={t}
                  />
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
                    onSubmitPhaseResponse={submitPhaseResponse}
                    draftsByPhaseId={draftsByPhaseId}
                    onTaskDraftChange={setTaskDraft}
                    autoSendOutcomesByPhaseId={deadlineDrafts.outcomesByPhaseId}
                    chatRefreshTokenByPhaseId={chatRefreshTokenByPhaseId}
                    externalResponseProcessingByPhaseId={externalResponseProcessingByPhaseId}
                    externalResultsByPhaseId={externalResultsByPhaseId}
                    expandedExternalResultKeys={expandedExternalResultKeys}
                    onToggleExternalResult={onToggleExternalResult}
                    locale={locale}
                    userId={session.uid}
                  />
                </CaseVideosProvider>
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

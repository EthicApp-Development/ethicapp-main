import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { studentApi } from '../api/studentApi.js';
import { useI18n } from '../app/providers.jsx';
import { useStudentActivityState } from '../context/StudentActivityStateContext.jsx';
import { getStudentSocket } from '../services/studentSocket.js';
import { formatSessionDate, sessionStatusLabel } from '../utils/sessionFormat.js';

export default function SessionDetailPage() {
  const { locale, t } = useI18n();
  const { session, sessionRefreshKey } = useOutletContext();
  const { sessionId } = useParams();
  const [joinedSessions, setJoinedSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState('');
  const { stateBySession, loadingBySession, errorBySession, loadFullState } = useStudentActivityState();

  useEffect(() => {
    if (!session.isAuthenticated) {
      setJoinedSessions([]);
      setLoadingSessions(false);
      setSessionsError('');
      return;
    }

    setLoadingSessions(true);
    setSessionsError('');

    studentApi
      .get('sessions')
      .then(({ data }) => {
        setJoinedSessions(Array.isArray(data) ? data : []);
        setLoadingSessions(false);
      })
      .catch((error) => {
        const message = axios.isAxiosError(error)
          ? (error.response?.data?.error ?? t('sessionDetail.loadErrorFallback'))
          : t('sessionDetail.loadErrorFallback');

        setSessionsError(message);
        setJoinedSessions([]);
        setLoadingSessions(false);
      });
  }, [session.isAuthenticated, sessionRefreshKey, t]);

  const selectedSession = useMemo(() => {
    const parsedSessionId = Number(sessionId);
    return joinedSessions.find((joinedSession) => joinedSession.id === parsedSessionId) ?? null;
  }, [joinedSessions, sessionId]);

  const selectedSessionId = Number(sessionId);
  const activityState = stateBySession[selectedSessionId] ?? null;
  const loadingActivityState = loadingBySession[selectedSessionId] ?? false;
  const activityStateError = errorBySession[selectedSessionId] ?? '';

  useEffect(() => {
    if (!session.isAuthenticated || !selectedSession || !session.uid) {
      return;
    }

    loadFullState({
      sessionId: selectedSession.id,
      userId: session.uid
    }).catch(() => {
      // The error is already reflected in the context state.
    });
  }, [loadFullState, selectedSession, session.isAuthenticated, session.uid]);

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

      {loadingSessions ? <p className="text-muted">{t('sessionDetail.loadingDetail')}</p> : null}

      {sessionsError ? (
        <div className="alert alert-danger" role="alert">
          {sessionsError}
        </div>
      ) : null}

      {!loadingSessions && !sessionsError && session.isAuthenticated ? (
        selectedSession ? (
          <article className="card shadow-sm">
            <div className="card-body">
              <h2 className="h5 mb-2">{selectedSession.name ?? `${t('sessions.sessionFallbackName')} #${selectedSession.id}`}</h2>
              <p className="text-secondary mb-3">{selectedSession.descr || t('sessionDetail.noDescription')}</p>

              <dl className="row mb-0">
                <dt className="col-sm-3">{t('sessionDetail.status')}</dt>
                <dd className="col-sm-9">{sessionStatusLabel(selectedSession.status, t)}</dd>

                <dt className="col-sm-3">{t('sessionDetail.date')}</dt>
                <dd className="col-sm-9">{formatSessionDate(selectedSession.time, locale, t)}</dd>

                <dt className="col-sm-3">{t('sessionDetail.code')}</dt>
                <dd className="col-sm-9">{selectedSession.code ?? t('sessionDetail.unavailable')}</dd>

                <dt className="col-sm-3">{t('sessionDetail.type')}</dt>
                <dd className="col-sm-9">{selectedSession.type ?? t('sessionDetail.noType')}</dd>

                <dt className="col-sm-3">{t('sessionDetail.activePhaseNumber')}</dt>
                <dd className="col-sm-9">{currentPhaseNumber ?? t('sessionDetail.unavailable')}</dd>

                <dt className="col-sm-3">{t('sessionDetail.activePhaseId')}</dt>
                <dd className="col-sm-9">{currentPhaseId ?? t('sessionDetail.unavailable')}</dd>
              </dl>

              {loadingActivityState ? <p className="text-muted mt-3 mb-0">{t('sessionDetail.loadingActivityState')}</p> : null}

              {activityStateError ? (
                <div className="alert alert-warning mt-3 mb-0" role="alert">
                  {activityStateError}
                </div>
              ) : null}

              {!loadingActivityState && !activityStateError && phaseTabs.length > 0 ? (
                <section className="mt-4" aria-label={t('sessionDetail.activityPhasesLabel')}>
                  <h3 className="h6 mb-2">{t('sessionDetail.phasesTitle')}</h3>
                  <div className="d-flex gap-2 flex-wrap">
                    {phaseTabs.map((phase) => {
                      const isCurrent = Number(phase.number) === Number(currentPhaseNumber);
                      return (
                        <span
                          key={phase.id ?? phase.number}
                          className={`phase-pill ${isCurrent ? 'phase-pill--current' : 'phase-pill--inactive'}`}
                        >
                          {t('sessionDetail.phaseN')} {phase.number}
                        </span>
                      );
                    })}
                  </div>
                </section>
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

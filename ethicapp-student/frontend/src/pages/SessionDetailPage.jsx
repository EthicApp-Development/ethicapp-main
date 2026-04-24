import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { studentApi } from '../api/studentApi.js';
import { useStudentActivityState } from '../context/StudentActivityStateContext.jsx';
import { getStudentSocket } from '../services/studentSocket.js';
import { formatSessionDate, sessionStatusLabel } from '../utils/sessionFormat.js';

export default function SessionDetailPage() {
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
          ? (error.response?.data?.error ?? 'No se pudieron cargar los datos de la sesión')
          : 'No se pudieron cargar los datos de la sesión';

        setSessionsError(message);
        setJoinedSessions([]);
        setLoadingSessions(false);
      });
  }, [session.isAuthenticated, sessionRefreshKey]);

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
      // El error ya queda reflejado en el contexto.
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
        <h1 className="h4 mb-0">Detalle de sesión</h1>
        <Link to="/" className="btn btn-outline-secondary btn-sm">
          Volver al home
        </Link>
      </div>

      {!session.isAuthenticated ? <p className="text-muted">Inicia sesión para revisar la sesión seleccionada.</p> : null}

      {loadingSessions ? <p className="text-muted">Cargando detalle...</p> : null}

      {sessionsError ? (
        <div className="alert alert-danger" role="alert">
          {sessionsError}
        </div>
      ) : null}

      {!loadingSessions && !sessionsError && session.isAuthenticated ? (
        selectedSession ? (
          <article className="card shadow-sm">
            <div className="card-body">
              <h2 className="h5 mb-2">{selectedSession.name ?? `Sesión #${selectedSession.id}`}</h2>
              <p className="text-secondary mb-3">{selectedSession.descr || 'Sin descripción'}</p>

              <dl className="row mb-0">
                <dt className="col-sm-3">Estado</dt>
                <dd className="col-sm-9">{sessionStatusLabel(selectedSession.status)}</dd>

                <dt className="col-sm-3">Fecha</dt>
                <dd className="col-sm-9">{formatSessionDate(selectedSession.time)}</dd>

                <dt className="col-sm-3">Código</dt>
                <dd className="col-sm-9">{selectedSession.code ?? 'No disponible'}</dd>

                <dt className="col-sm-3">Tipo</dt>
                <dd className="col-sm-9">{selectedSession.type ?? 'Sin tipo'}</dd>

                <dt className="col-sm-3">Fase activa #</dt>
                <dd className="col-sm-9">{currentPhaseNumber ?? 'No disponible'}</dd>

                <dt className="col-sm-3">Fase activa ID</dt>
                <dd className="col-sm-9">{currentPhaseId ?? 'No disponible'}</dd>
              </dl>

              {loadingActivityState ? <p className="text-muted mt-3 mb-0">Cargando estado completo de la actividad...</p> : null}

              {activityStateError ? (
                <div className="alert alert-warning mt-3 mb-0" role="alert">
                  {activityStateError}
                </div>
              ) : null}

              {!loadingActivityState && !activityStateError && phaseTabs.length > 0 ? (
                <section className="mt-4" aria-label="Fases de la actividad">
                  <h3 className="h6 mb-2">Fases</h3>
                  <div className="d-flex gap-2 flex-wrap">
                    {phaseTabs.map((phase) => {
                      const isCurrent = Number(phase.number) === Number(currentPhaseNumber);
                      return (
                        <span
                          key={phase.id ?? phase.number}
                          className={`phase-pill ${isCurrent ? 'phase-pill--current' : 'phase-pill--inactive'}`}
                        >
                          Fase {phase.number}
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
            No encontramos la sesión solicitada dentro de tus sesiones disponibles.
          </div>
        )
      ) : null}
    </section>
  );
}

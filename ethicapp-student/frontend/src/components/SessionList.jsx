import { useEffect, useState } from 'react';
import { formatSessionDate, sessionStatusLabel } from '../utils/sessionFormat.js';

export default function SessionList({ isAuthenticated, refreshKey, onSessionSelect }) {
  const [joinedSessions, setJoinedSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState('');

  useEffect(() => {
    if (!isAuthenticated) {
      setJoinedSessions([]);
      setLoadingSessions(false);
      setSessionsError('');
      return;
    }

    setLoadingSessions(true);
    setSessionsError('');

    fetch('/student/api/sessions', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? 'No se pudieron cargar las sesiones');
        }

        return response.json();
      })
      .then((rows) => {
        setJoinedSessions(Array.isArray(rows) ? rows : []);
        setLoadingSessions(false);
      })
      .catch((error) => {
        setSessionsError(error.message);
        setJoinedSessions([]);
        setLoadingSessions(false);
      });
  }, [isAuthenticated, refreshKey]);

  return (
    <div className="card h-100 shadow-sm">
      <div className="card-body">
        <h2 className="h5 mb-3">Mis sesiones</h2>

        {!isAuthenticated && <p className="text-muted mb-0">Inicia sesión para ver tus sesiones previas.</p>}

        {isAuthenticated && loadingSessions ? <p className="text-muted mb-0">Cargando sesiones...</p> : null}

        {sessionsError ? (
          <div className="alert alert-danger py-2 mb-0" role="alert">
            {sessionsError}
          </div>
        ) : null}

        {!loadingSessions && isAuthenticated && !sessionsError ? (
          joinedSessions.length > 0 ? (
            <div className="d-flex flex-column gap-3">
              {joinedSessions.map((joinedSession) => (
                <article key={joinedSession.id} className="card nested-card shadow-sm border-1">
                  <button
                    type="button"
                    className="btn text-start w-100 p-0"
                    onClick={() => onSessionSelect?.(joinedSession.id)}
                  >
                    <div className="card-body">
                      <h3 className="h6 mb-1">
                        {joinedSession.name ?? `Sesión #${joinedSession.id}`}
                      </h3>

                      <p className="mb-2 small text-secondary">
                        {joinedSession.descr || 'Sin descripción'}
                      </p>

                      <div className="small text-muted d-flex flex-wrap gap-2">
                        <span>Estado: {sessionStatusLabel(joinedSession.status)}</span>
                        <span>Fecha: {formatSessionDate(joinedSession.time)}</span>
                        <span>Código: {joinedSession.code}</span>
                      </div>
                    </div>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-muted mb-0">Aún no te has unido a ninguna sesión.</p>
          )
        ) : null}
      </div>
    </div>
  );
}

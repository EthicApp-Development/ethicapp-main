import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { formatSessionDate, sessionStatusLabel } from '../utils/sessionFormat.js';

export default function SessionDetailPage() {
  const { session, sessionRefreshKey } = useOutletContext();
  const { sessionId } = useParams();
  const [joinedSessions, setJoinedSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState('');

  useEffect(() => {
    if (!session.isAuthenticated) {
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
          throw new Error(payload?.error ?? 'No se pudieron cargar los datos de la sesión');
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
  }, [session.isAuthenticated, sessionRefreshKey]);

  const selectedSession = useMemo(() => {
    const parsedSessionId = Number(sessionId);
    return joinedSessions.find((joinedSession) => joinedSession.id === parsedSessionId) ?? null;
  }, [joinedSessions, sessionId]);

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
              </dl>
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

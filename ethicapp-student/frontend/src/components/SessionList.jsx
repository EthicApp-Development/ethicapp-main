import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { studentApi } from '../api/studentApi.js';
import { formatSessionDate, sessionStatusLabel } from '../utils/sessionFormat.js';

export default function SessionList({
  isAuthenticated,
  refreshKey,
  onSessionSelect,
  title = 'Mis sesiones',
  limit,
  enablePagination = false,
  pageSize = 10
}) {
  const [joinedSessions, setJoinedSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!isAuthenticated) {
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
          ? (error.response?.data?.error ?? 'No se pudieron cargar las sesiones')
          : 'No se pudieron cargar las sesiones';

        setSessionsError(message);
        setJoinedSessions([]);
        setLoadingSessions(false);
      });
  }, [isAuthenticated, refreshKey]);

  useEffect(() => {
    setCurrentPage(1);
  }, [refreshKey, isAuthenticated, limit, enablePagination, pageSize]);

  const sortedSessions = useMemo(() => {
    return [...joinedSessions].sort((a, b) => {
      const aTime = new Date(a?.time ?? 0).getTime();
      const bTime = new Date(b?.time ?? 0).getTime();

      if (aTime !== bTime) {
        return bTime - aTime;
      }

      return (b?.id ?? 0) - (a?.id ?? 0);
    });
  }, [joinedSessions]);

  const totalPages = enablePagination ? Math.max(1, Math.ceil(sortedSessions.length / pageSize)) : 1;
  const safePage = Math.min(currentPage, totalPages);

  const visibleSessions = useMemo(() => {
    if (enablePagination) {
      const start = (safePage - 1) * pageSize;
      return sortedSessions.slice(start, start + pageSize);
    }

    if (Number.isInteger(limit) && limit > 0) {
      return sortedSessions.slice(0, limit);
    }

    return sortedSessions;
  }, [enablePagination, safePage, pageSize, sortedSessions, limit]);

  return (
    <div className="card h-100 shadow-sm">
      <div className="card-body">
        <h2 className="h5 mb-3">{title}</h2>

        {!isAuthenticated && <p className="text-muted mb-0">Inicia sesión para ver tus sesiones previas.</p>}

        {isAuthenticated && loadingSessions ? <p className="text-muted mb-0">Cargando sesiones...</p> : null}

        {sessionsError ? (
          <div className="alert alert-danger py-2 mb-0" role="alert">
            {sessionsError}
          </div>
        ) : null}

        {!loadingSessions && isAuthenticated && !sessionsError ? (
          visibleSessions.length > 0 ? (
            <div className="d-flex flex-column gap-3">
              {visibleSessions.map((joinedSession) => (
                <article key={joinedSession.id} className="card nested-card shadow-sm border-1">
                  <button
                    type="button"
                    className="btn text-start w-100 p-0"
                    onClick={() => onSessionSelect?.(joinedSession.id)}
                  >
                    <div className="card-body">
                      <h3 className="h6 mb-1">{joinedSession.name ?? `Sesión #${joinedSession.id}`}</h3>

                      <p className="mb-2 small text-secondary">{joinedSession.descr || 'Sin descripción'}</p>

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

        {!loadingSessions && isAuthenticated && !sessionsError && enablePagination && totalPages > 1 ? (
          <nav aria-label="Paginación de sesiones" className="mt-4 d-flex justify-content-end">
            <ul className="pagination pagination-sm mb-0">
              <li className={`page-item ${safePage === 1 ? 'disabled' : ''}`}>
                <button
                  type="button"
                  className="page-link"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  aria-label="Página anterior"
                >
                  Anterior
                </button>
              </li>

              {Array.from({ length: totalPages }, (_, index) => {
                const pageNumber = index + 1;

                return (
                  <li key={pageNumber} className={`page-item ${safePage === pageNumber ? 'active' : ''}`}>
                    <button type="button" className="page-link" onClick={() => setCurrentPage(pageNumber)}>
                      {pageNumber}
                    </button>
                  </li>
                );
              })}

              <li className={`page-item ${safePage === totalPages ? 'disabled' : ''}`}>
                <button
                  type="button"
                  className="page-link"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  aria-label="Página siguiente"
                >
                  Siguiente
                </button>
              </li>
            </ul>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

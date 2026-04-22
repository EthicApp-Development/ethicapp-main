import { useEffect, useState } from 'react';

export default function App() {
  const [session, setSession] = useState({ isAuthenticated: false, uid: null, role: null });

  useEffect(() => {
    fetch('/student/api/session', { credentials: 'include' })
      .then((response) => response.json())
      .then((data) => setSession(data))
      .catch(() => {
        setSession({ isAuthenticated: false, uid: null, role: null });
      });
  }, []);

  return (
    <main className="container py-5">
      <h1 className="mb-3">EthicApp Student</h1>
      <p className="text-muted">Aplicación base para rutas bajo <code>/student</code>.</p>
      <div className="card p-3">
        <h2 className="h5">Sesión actual</h2>
        <ul className="mb-0">
          <li>Autenticado: {session.isAuthenticated ? 'Sí' : 'No'}</li>
          <li>UID: {session.uid ?? '-'}</li>
          <li>Rol: {session.role ?? '-'}</li>
        </ul>
      </div>
    </main>
  );
}

import { useState } from 'react';

export default function JoinSessionCard({ disabled, onJoined }) {
  const [joinCode, setJoinCode] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinFeedback, setJoinFeedback] = useState(null);

  const handleJoinSession = async (event) => {
    event.preventDefault();

    const normalizedCode = joinCode.trim();
    if (!normalizedCode) {
      setJoinFeedback({ type: 'danger', message: 'Ingresa un código de sesión válido.' });
      return;
    }

    setJoinBusy(true);
    setJoinFeedback(null);

    try {
      const response = await fetch('/student/sessions/join', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: normalizedCode,
          device: 'web'
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error ?? 'No fue posible unirse a la sesión');
      }

      setJoinFeedback({ type: 'success', message: 'Te uniste a la sesión correctamente.' });
      setJoinCode('');
      onJoined();
    } catch (error) {
      setJoinFeedback({ type: 'danger', message: error.message });
    } finally {
      setJoinBusy(false);
    }
  };

  return (
    <div className="card shadow-sm h-100">
      <div className="card-body d-flex flex-column">
        <h2 className="h5 mb-2">Unirse a una sesión</h2>
        <p className="text-muted small mb-3">
          Ingresa el código compartido por tu profesor. El formulario es compatible con móvil y escritorio.
        </p>

        <form className="mt-auto" onSubmit={handleJoinSession}>
          <div className="input-group input-group-lg">
            <input
              type="text"
              className="form-control"
              placeholder="Ej: ABC123"
              aria-label="Código de sesión"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            />
            <button className="btn btn-primary" type="submit" disabled={joinBusy || disabled}>
              {joinBusy ? 'Uniendo...' : 'Unirse'}
            </button>
          </div>
        </form>

        {joinFeedback ? (
          <div className={`alert alert-${joinFeedback.type} py-2 mt-3 mb-0`} role="alert">
            {joinFeedback.message}
          </div>
        ) : null}
      </div>
    </div>
  );
}

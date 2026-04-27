import axios from 'axios';
import { useState } from 'react';
import { studentApi } from '../api/studentApi.js';

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
      const { data } = await studentApi.post('sessions/join', {
        code: normalizedCode,
        device: 'web'
      });

      const alreadyJoined = Boolean(data?.alreadyJoined);
      const sessionId = Number(data?.sesid);

      setJoinFeedback({
        type: 'success',
        message: alreadyJoined
          ? 'Ya habías ingresado a esta sesión. Redirigiendo...'
          : 'Te uniste a la sesión correctamente. Redirigiendo...'
      });
      setJoinCode('');
      onJoined(sessionId, { alreadyJoined });
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data?.error ?? 'No fue posible unirse a la sesión')
        : 'No fue posible unirse a la sesión';

      setJoinFeedback({ type: 'danger', message });
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
              placeholder="Ej: k0010d"
              aria-label="Código de sesión"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toLowerCase())}
            />
            <button className="btn btn-primary" type="submit" disabled={joinBusy || disabled}>
              <span className="d-inline-flex align-items-center gap-2">
                <i className={`fa-solid ${joinBusy ? 'fa-spinner fa-spin' : 'fa-right-to-bracket'}`} aria-hidden="true" />
                <span>{joinBusy ? 'Uniendo...' : 'Unirse'}</span>
              </span>
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

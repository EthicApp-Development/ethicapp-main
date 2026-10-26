import { useRef, useState } from 'react';
import { studentApi } from '../api/studentApi.js';
import { withReference } from '../api/apiErrors.js';
import { useI18n } from '../app/providers.jsx';
import { interpretJoinError, interpretJoinResponse } from '../utils/joinSessionOutcome.js';

export default function JoinSessionCard({ disabled, onJoined }) {
  const { t } = useI18n();
  const [joinCode, setJoinCode] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinFeedback, setJoinFeedback] = useState(null);
  // Set synchronously so a second Enter press before re-render cannot resubmit.
  const submittingRef = useRef(false);

  const handleJoinSession = async (event) => {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    const normalizedCode = joinCode.trim().toLowerCase();
    if (!normalizedCode) {
      setJoinFeedback({ type: 'danger', message: t('joinSession.invalidCode') });
      return;
    }

    submittingRef.current = true;
    setJoinBusy(true);
    setJoinFeedback(null);

    let result;
    try {
      result = interpretJoinResponse(
        await studentApi.post('sessions/join', { code: normalizedCode, device: 'web' })
      );
    } catch (error) {
      result = interpretJoinError(error);
    }

    setJoinFeedback({
      type: result.succeeded ? 'success' : 'danger',
      message: withReference(t(result.messageKey), result.requestId, t)
    });
    submittingRef.current = false;
    setJoinBusy(false);

    if (result.succeeded) {
      setJoinCode('');
      onJoined(result.sessionId, { alreadyJoined: result.kind === 'already_joined' });
    }
  };

  return (
    <div className="card shadow-sm h-100">
      <div className="card-body d-flex flex-column">
        <h2 className="h5 mb-2">{t('joinSession.title')}</h2>
        <p className="text-muted small mb-3">{t('joinSession.description')}</p>

        <form className="mt-auto" onSubmit={handleJoinSession}>
          <div className="input-group input-group-lg">
            <input
              type="text"
              className="form-control"
              placeholder={t('joinSession.placeholder')}
              aria-label={t('joinSession.ariaSessionCode')}
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toLowerCase())}
            />
            <button className="btn btn-primary" type="submit" disabled={joinBusy || disabled}>
              <span className="d-inline-flex align-items-center gap-2">
                <i className={`fa-solid ${joinBusy ? 'fa-spinner fa-spin' : 'fa-right-to-bracket'}`} aria-hidden="true" />
                <span>{joinBusy ? t('joinSession.joiningAction') : t('joinSession.joinAction')}</span>
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

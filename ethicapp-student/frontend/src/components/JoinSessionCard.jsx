import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { studentApi } from '../api/studentApi.js';
import { withReference } from '../api/apiErrors.js';
import { useI18n } from '../app/providers.jsx';
import {
  buildJoinReturnTo,
  interpretJoinError,
  interpretJoinResponse,
  normalizeJoinCode
} from '../utils/joinSessionOutcome.js';

export default function JoinSessionCard({ disabled, onJoined }) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [joinCode, setJoinCode] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinFeedback, setJoinFeedback] = useState(null);
  // Set synchronously so a second Enter press before re-render cannot resubmit.
  const submittingRef = useRef(false);
  const resumedJoinRef = useRef(false);

  const submitJoin = useCallback(async (code) => {
    if (submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setJoinBusy(true);
    setJoinFeedback(null);

    let result;
    try {
      result = interpretJoinResponse(
        await studentApi.post(
          'sessions/join',
          { code, device: 'web' },
          // If the session expired, sign-in brings the student back here to finish this join.
          { expiryReturnTo: buildJoinReturnTo(code) }
        )
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
  }, [onJoined, t]);

  // /student/?join=<code> resumes a join interrupted by an expired session.
  const pendingJoinCode = normalizeJoinCode(searchParams.get('join'));

  useEffect(() => {
    if (!pendingJoinCode || disabled || resumedJoinRef.current) {
      return;
    }

    resumedJoinRef.current = true;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('join');
      return next;
    }, { replace: true });
    setJoinCode(pendingJoinCode);
    submitJoin(pendingJoinCode);
  }, [disabled, pendingJoinCode, setSearchParams, submitJoin]);

  const handleJoinSession = (event) => {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    const normalizedCode = joinCode.trim().toLowerCase();
    if (!normalizedCode) {
      setJoinFeedback({ type: 'danger', message: t('joinSession.invalidCode') });
      return;
    }

    submitJoin(normalizedCode);
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

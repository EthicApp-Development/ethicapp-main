import axios from 'axios';
import { useState } from 'react';
import { legacyUserApi } from '../api/studentApi.js';
import { useI18n } from '../app/providers.jsx';

export default function JoinSessionCard({ disabled, onJoined }) {
  const { t } = useI18n();
  const [joinCode, setJoinCode] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinFeedback, setJoinFeedback] = useState(null);

  const handleJoinSession = async (event) => {
    event.preventDefault();

    const normalizedCode = joinCode.trim();
    if (!normalizedCode) {
      setJoinFeedback({ type: 'danger', message: t('joinSession.invalidCode') });
      return;
    }

    setJoinBusy(true);
    setJoinFeedback(null);

    try {
      const { data } = await legacyUserApi.post(`/sessions/join/${normalizedCode.toLowerCase()}`, {
        device: 'web'
      });

      if (data?.status !== 'ok') {
        throw new Error(t('joinSession.joinErrorFallback'));
      }

      const alreadyJoined = false;
      const sessionId = Number(data?.sesid);

      setJoinFeedback({
        type: 'success',
        message: alreadyJoined ? t('joinSession.alreadyJoined') : t('joinSession.joinedSuccess')
      });
      setJoinCode('');
      onJoined(sessionId, { alreadyJoined });
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? (error.response?.data?.error ?? t('joinSession.joinErrorFallback'))
        : t('joinSession.joinErrorFallback');

      setJoinFeedback({ type: 'danger', message });
    } finally {
      setJoinBusy(false);
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

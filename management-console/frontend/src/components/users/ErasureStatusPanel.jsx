import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { fetchErasureRequests, retryErasureRequests } from '../../api/userForgettingApi.js';
import { canRetryErasure, erasureDisplayStatus } from './erasureStatus.js';

const STATUS_CLASSES = Object.freeze({
  done: 'text-success',
  pending: 'text-body-secondary',
  retrying: 'text-warning-emphasis',
  failed: 'text-danger'
});

// Where a forgotten account's data has been erased (#876): EthicApp, which
// erased it when the account was forgotten, and each AI Additions service,
// which erases it in the background. For example
// "EthicApp ✓ · Tutor ✓ · Polyadic: retrying". Offers a retry while a
// service has not confirmed its erasure.
function ErasureStatusPanel({ userId }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [state, setState] = useState({ ok: true, requests: [] });
  const [retryError, setRetryError] = useState('');

  const serviceLabel = useCallback(
    (serviceId) => {
      const key = `pages.userForget.status.services.${serviceId}`;
      const label = t(key);
      return label === key ? serviceId : label;
    },
    [t]
  );

  useEffect(() => {
    let active = true;

    fetchErasureRequests(userId)
      .then((result) => {
        if (active) {
          setState(result?.ok ? result : { ok: false, requests: [] });
        }
      })
      .catch(() => {
        if (active) {
          setState({ ok: false, requests: [] });
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [userId]);

  async function onRetry() {
    setRetrying(true);
    setRetryError('');

    try {
      const result = await retryErasureRequests(userId);
      if (result?.ok) {
        setState(result);
      } else {
        setRetryError(t('pages.userForget.status.retryError'));
      }
    } catch {
      setRetryError(t('pages.userForget.status.retryError'));
    } finally {
      setRetrying(false);
    }
  }

  const requests = state.ok ? state.requests : [];

  return (
    <section className="mt-4" data-testid="erasure-status" aria-labelledby="erasure-status-heading">
      <h2 id="erasure-status-heading" className="h6">
        <i className="fa-solid fa-eraser me-2" aria-hidden="true" />
        {t('pages.userForget.status.heading')}
      </h2>

      {loading ? (
        <Spinner size="sm" role="status" />
      ) : (
        <>
          <p className="mb-1" data-testid="erasure-status-line">
            <span className="text-success" data-testid="erasure-status-ethicapp" data-erasure-status="done">
              {t('pages.userForget.status.done', { service: t('pages.userForget.status.ethicapp') })}
            </span>
            {requests.map((request) => {
              const status = erasureDisplayStatus(request);
              return (
                <span key={request.serviceId}>
                  {' · '}
                  <span
                    className={STATUS_CLASSES[status]}
                    data-testid={`erasure-status-${request.serviceId}`}
                    data-erasure-status={status}
                  >
                    {t(`pages.userForget.status.${status}`, { service: serviceLabel(request.serviceId) })}
                  </span>
                </span>
              );
            })}
          </p>

          {!state.ok ? (
            <Alert variant="warning" className="py-2 small" data-testid="erasure-status-unavailable">
              {t('pages.userForget.status.unavailable')}
            </Alert>
          ) : null}
          {state.ok && requests.length === 0 ? (
            <p className="form-text" data-testid="erasure-status-none">{t('pages.userForget.status.none')}</p>
          ) : null}
          {requests.length > 0 ? (
            <p className="form-text">{t('pages.userForget.status.help')}</p>
          ) : null}
          {requests.filter((request) => request.lastError && request.status !== 'done').map((request) => (
            <p key={request.serviceId} className="form-text mb-1" data-testid={`erasure-last-error-${request.serviceId}`}>
              {serviceLabel(request.serviceId)}: {t('pages.userForget.status.lastError', { code: request.lastError })}
            </p>
          ))}

          {retryError ? (
            <Alert variant="danger" className="py-2 small" data-testid="erasure-retry-error">{retryError}</Alert>
          ) : null}

          {canRetryErasure(requests) ? (
            <Button
              type="button"
              size="sm"
              variant="outline-secondary"
              data-testid="erasure-retry-button"
              disabled={retrying}
              onClick={onRetry}
            >
              {retrying ? <Spinner size="sm" className="me-2" aria-hidden="true" /> : (
                <i className="fa-solid fa-rotate-right me-2" aria-hidden="true" />
              )}
              {t('pages.userForget.status.retry')}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

ErasureStatusPanel.propTypes = {
  userId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired
};

export default ErasureStatusPanel;

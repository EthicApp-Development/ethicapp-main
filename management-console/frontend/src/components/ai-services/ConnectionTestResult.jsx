import PropTypes from 'prop-types';
import { Alert, ListGroup } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { aiErrorKey, issuerMismatchHint } from './aiServicesFormat.js';

function stepStatus(step) {
  if (step.ok) {
    return { key: 'ok', icon: 'fa-circle-check text-success' };
  }
  if (step.skipped) {
    return { key: 'skipped', icon: 'fa-circle-minus text-body-secondary' };
  }
  return { key: 'failed', icon: 'fa-circle-xmark text-danger' };
}

function TestStep({ label, step, errorKey, children }) {
  const { t } = useI18n();
  const status = stepStatus(step);

  return (
    <ListGroup.Item>
      <div className="d-flex flex-wrap align-items-baseline gap-2">
        <i className={`fa-solid ${status.icon}`} aria-hidden="true" />
        <strong>{label}</strong>
        <span>{t(`pages.aiServices.connection.test.status.${status.key}`)}</span>
        {step.error ? <span className="text-body-secondary small">{t(errorKey || aiErrorKey(step.error))}</span> : null}
      </div>
      {children}
    </ListGroup.Item>
  );
}

const stepShape = PropTypes.shape({
  ok: PropTypes.bool.isRequired,
  error: PropTypes.string,
  skipped: PropTypes.bool
});

const issuerStepShape = PropTypes.shape({
  ok: PropTypes.bool.isRequired,
  error: PropTypes.string,
  skipped: PropTypes.bool,
  expected: PropTypes.string,
  actual: PropTypes.string
});

TestStep.propTypes = {
  label: PropTypes.string.isRequired,
  step: stepShape.isRequired,
  errorKey: PropTypes.string,
  children: PropTypes.node
};

// Expected vs actual issuer, and the Keycloak public URL that would match.
function IssuerMismatchDetails({ expected, actual }) {
  const { t } = useI18n();
  const hint = issuerMismatchHint(expected, actual);

  return (
    <div className="small mt-2" data-testid="ai-connection-test-issuer-mismatch">
      <p className="mb-1">{t('pages.aiServices.connection.test.issuer.mismatchExplanation')}</p>
      <dl className="row mb-1">
        <dt className="col-sm-3">{t('pages.aiServices.connection.test.issuer.expected')}</dt>
        <dd className="col-sm-9 text-break"><code>{expected || '-'}</code></dd>
        <dt className="col-sm-3">{t('pages.aiServices.connection.test.issuer.actual')}</dt>
        <dd className="col-sm-9 text-break"><code>{actual || '-'}</code></dd>
      </dl>
      {hint?.keycloakPublicUrl ? (
        <p className="mb-0">
          {t('pages.aiServices.connection.test.issuer.suggestion')}{' '}
          <code className="text-break" data-testid="ai-connection-test-issuer-suggestion">{hint.keycloakPublicUrl}</code>
        </p>
      ) : null}
      {hint?.realmMismatch ? (
        <p className="mb-0">{t('pages.aiServices.connection.test.issuer.realmMismatch')}</p>
      ) : null}
    </div>
  );
}

IssuerMismatchDetails.propTypes = {
  expected: PropTypes.string,
  actual: PropTypes.string
};

function issuerErrorKey(step) {
  return step.error === 'invalid_response' ? 'pages.aiServices.connection.test.issuer.invalidToken' : null;
}

// Result of POST /mng/api/ai-services/connection/test: each step, the service
// count, and a top-level error when ethicapp itself could not be reached. The
// issuer step is null when ethicapp does not report it (before #834).
function ConnectionTestResult({ result }) {
  const { t } = useI18n();
  const ethicappFailed = !result.ok && result.token.skipped && result.catalog.skipped;
  const { issuer } = result;

  return (
    <div className="mt-3" data-testid="ai-connection-test-result">
      <Alert variant={result.ok ? 'success' : 'danger'} className="mb-2">
        {result.ok
          ? t('pages.aiServices.connection.test.success', { count: result.serviceCount ?? 0 })
          : t('pages.aiServices.connection.test.failure')}
        {ethicappFailed ? <div className="small mt-1">{t(aiErrorKey(result.error))}</div> : null}
      </Alert>
      <ListGroup>
        <TestStep label={t('pages.aiServices.connection.test.token')} step={result.token} />
        {issuer ? (
          <TestStep label={t('pages.aiServices.connection.test.issuer.label')} step={issuer} errorKey={issuerErrorKey(issuer)}>
            {issuer.error === 'issuer_mismatch'
              ? <IssuerMismatchDetails expected={issuer.expected} actual={issuer.actual} />
              : null}
          </TestStep>
        ) : null}
        <TestStep label={t('pages.aiServices.connection.test.catalog')} step={result.catalog} />
      </ListGroup>
    </div>
  );
}

ConnectionTestResult.propTypes = {
  result: PropTypes.shape({
    ok: PropTypes.bool.isRequired,
    error: PropTypes.string,
    token: stepShape.isRequired,
    issuer: issuerStepShape,
    catalog: stepShape.isRequired,
    serviceCount: PropTypes.number
  }).isRequired
};

export default ConnectionTestResult;

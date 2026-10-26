import PropTypes from 'prop-types';
import { Alert, ListGroup } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { aiErrorKey } from './aiServicesFormat.js';

function stepStatus(step) {
  if (step.ok) {
    return { key: 'ok', icon: 'fa-circle-check text-success' };
  }
  if (step.skipped) {
    return { key: 'skipped', icon: 'fa-circle-minus text-body-secondary' };
  }
  return { key: 'failed', icon: 'fa-circle-xmark text-danger' };
}

function TestStep({ label, step }) {
  const { t } = useI18n();
  const status = stepStatus(step);

  return (
    <ListGroup.Item className="d-flex flex-wrap align-items-baseline gap-2">
      <i className={`fa-solid ${status.icon}`} aria-hidden="true" />
      <strong>{label}</strong>
      <span>{t(`pages.aiServices.connection.test.status.${status.key}`)}</span>
      {step.error ? <span className="text-body-secondary small">{t(aiErrorKey(step.error))}</span> : null}
    </ListGroup.Item>
  );
}

const stepShape = PropTypes.shape({
  ok: PropTypes.bool.isRequired,
  error: PropTypes.string,
  skipped: PropTypes.bool
});

TestStep.propTypes = {
  label: PropTypes.string.isRequired,
  step: stepShape.isRequired
};

// Result of POST /mng/api/ai-services/connection/test: each step, the service
// count, and a top-level error when ethicapp itself could not be reached.
function ConnectionTestResult({ result }) {
  const { t } = useI18n();
  const ethicappFailed = !result.ok && result.token.skipped && result.catalog.skipped;

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
    catalog: stepShape.isRequired,
    serviceCount: PropTypes.number
  }).isRequired
};

export default ConnectionTestResult;

import PropTypes from 'prop-types';
import { Alert, Card, Spinner } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { formatDateTime } from './formatters.js';

// Shared frame for one diagnostics check: title, last-run time, and the
// loading / request-error states. Results are rendered by `children` once a
// report is available.
function CheckCard({ icon, title, description, state, children }) {
  const { t, locale } = useI18n();
  const { loading, error, report } = state;

  return (
    <Card className="mb-4">
      <Card.Body>
        <div className="d-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-2">
          <Card.Title className="d-flex align-items-center gap-2 mb-0">
            <i className={`fa-solid ${icon} text-primary`} aria-hidden="true" />
            <span>{title}</span>
          </Card.Title>
          {report ? (
            <span className="small text-body-secondary">
              {t('pages.diagnostics.lastRun', { time: formatDateTime(report.checkedAt, locale) })}
            </span>
          ) : null}
        </div>
        <Card.Text className="text-body-secondary">{description}</Card.Text>

        {error ? <Alert variant="danger">{error}</Alert> : null}

        {loading && !report ? (
          <div className="d-flex align-items-center gap-2">
            <Spinner size="sm" />
            <span>{t('pages.diagnostics.running')}</span>
          </div>
        ) : null}

        {report ? children : null}
      </Card.Body>
    </Card>
  );
}

CheckCard.propTypes = {
  icon: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  state: PropTypes.shape({
    loading: PropTypes.bool.isRequired,
    error: PropTypes.string.isRequired,
    report: PropTypes.object
  }).isRequired,
  children: PropTypes.node
};

export default CheckCard;

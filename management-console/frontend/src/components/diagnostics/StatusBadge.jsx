import PropTypes from 'prop-types';
import { Badge } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';

const STATUS_STYLES = {
  ok: { bg: 'success', icon: 'fa-circle-check' },
  failed: { bg: 'danger', icon: 'fa-circle-xmark' },
  skipped: { bg: 'secondary', icon: 'fa-circle-minus' }
};

function StatusBadge({ status }) {
  const { t } = useI18n();
  const style = STATUS_STYLES[status];

  return (
    <Badge bg={style.bg} className="d-inline-flex align-items-center gap-1">
      <i className={`fa-solid ${style.icon}`} aria-hidden="true" />
      {t(`pages.diagnostics.status.${status}`)}
    </Badge>
  );
}

StatusBadge.propTypes = {
  status: PropTypes.oneOf(Object.keys(STATUS_STYLES)).isRequired
};

export function statusOf(result) {
  if (!result) {
    return 'skipped';
  }

  if (result.skipped) {
    return 'skipped';
  }

  return result.ok ? 'ok' : 'failed';
}

export default StatusBadge;

import PropTypes from 'prop-types';
import { Badge, Card, Table } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { formatDateTime } from '../diagnostics/formatters.js';
import { formatServiceList } from './aiServicesFormat.js';

// Policy versions, newest first. Versions are immutable, so this is read-only.
function HistorySection({ versions, namesById }) {
  const { t, locale } = useI18n();

  return (
    <Card className="mb-4" as="section" aria-labelledby="ai-history-heading">
      <Card.Body>
        <Card.Title id="ai-history-heading" className="d-flex align-items-center gap-2">
          <i className="fa-solid fa-clock-rotate-left text-primary" aria-hidden="true" />
          {t('pages.aiServices.history.heading')}
        </Card.Title>
        <Card.Text className="text-body-secondary">{t('pages.aiServices.history.description')}</Card.Text>

        {versions.length === 0 ? (
          <p className="text-body-secondary mb-0">{t('pages.aiServices.history.empty')}</p>
        ) : (
          <Table responsive striped className="align-middle mb-0" data-testid="ai-policy-history">
            <thead>
              <tr>
                <th scope="col">{t('pages.aiServices.history.columns.version')}</th>
                <th scope="col">{t('pages.aiServices.history.columns.date')}</th>
                <th scope="col">{t('pages.aiServices.history.columns.author')}</th>
                <th scope="col">{t('pages.aiServices.history.columns.allowed')}</th>
                <th scope="col">{t('pages.aiServices.history.columns.note')}</th>
                <th scope="col" className="text-end">{t('pages.aiServices.history.columns.sessions')}</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version, index) => (
                <tr key={version.id}>
                  <td>
                    {version.id}
                    {index === 0 ? <Badge bg="primary" className="ms-2">{t('pages.aiServices.history.current')}</Badge> : null}
                  </td>
                  <td>{formatDateTime(version.createdAt, locale)}</td>
                  <td>{version.createdBy?.name || t('pages.aiServices.history.systemAuthor')}</td>
                  <td>
                    {version.allowedServiceIds.length > 0
                      ? formatServiceList(version.allowedServiceIds, namesById)
                      : <span className="text-body-secondary">{t('pages.aiServices.history.noServices')}</span>}
                  </td>
                  <td>{version.note || '—'}</td>
                  <td className="text-end">{version.launchedSessionCount}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
}

HistorySection.propTypes = {
  versions: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.number.isRequired,
    allowedServiceIds: PropTypes.arrayOf(PropTypes.string).isRequired,
    note: PropTypes.string,
    createdAt: PropTypes.string,
    createdBy: PropTypes.shape({ name: PropTypes.string }),
    launchedSessionCount: PropTypes.number.isRequired
  })).isRequired,
  namesById: PropTypes.instanceOf(Map).isRequired
};

export default HistorySection;

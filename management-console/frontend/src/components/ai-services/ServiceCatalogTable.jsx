import PropTypes from 'prop-types';
import { Badge, Form, Table } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import AdapterSwitches from './AdapterSwitches.jsx';

// The live AI Additions catalog with an "allowed" checkbox per service, and
// a switch per EthicApp adapter of each service, grouped by scope (#864).
function ServiceCatalogTable({ services, selectedIds, disabledAdapterIds, disabled, onToggle, onToggleAdapter }) {
  const { t } = useI18n();

  return (
    <Table responsive hover className="align-middle">
      <thead>
        <tr>
          <th scope="col">{t('pages.aiServices.services.columns.allowed')}</th>
          <th scope="col">{t('pages.aiServices.services.columns.service')}</th>
          <th scope="col">{t('pages.aiServices.services.columns.usesLlm')}</th>
          <th scope="col">{t('pages.aiServices.services.columns.availability')}</th>
          <th scope="col">{t('pages.aiServices.services.columns.adapters')}</th>
        </tr>
      </thead>
      <tbody>
        {services.map((service) => (
          <tr key={service.id}>
            <td>
              <Form.Check
                type="checkbox"
                id={`ai-service-allowed-${service.id}`}
                checked={selectedIds.has(service.id)}
                disabled={disabled}
                onChange={() => onToggle(service.id)}
                aria-label={t('pages.aiServices.services.allowService', { name: service.name })}
              />
            </td>
            <td>
              <div className="fw-semibold">{service.name}</div>
              <div className="small text-body-secondary"><code>{service.id}</code></div>
              {service.description ? <div className="small">{service.description}</div> : null}
            </td>
            <td>{t(service.usesLlm ? 'pages.aiServices.services.yes' : 'pages.aiServices.services.no')}</td>
            <td>
              <Badge bg={service.available ? 'success' : 'secondary'}>
                {t(service.available ? 'pages.aiServices.services.available' : 'pages.aiServices.services.unavailable')}
              </Badge>
            </td>
            <td>
              <AdapterSwitches
                service={service}
                serviceAllowed={selectedIds.has(service.id)}
                disabledAdapterIds={disabledAdapterIds}
                disabled={disabled}
                onToggle={onToggleAdapter}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

ServiceCatalogTable.propTypes = {
  services: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    description: PropTypes.string,
    usesLlm: PropTypes.bool,
    available: PropTypes.bool,
    adapters: PropTypes.array
  })).isRequired,
  selectedIds: PropTypes.instanceOf(Set).isRequired,
  disabledAdapterIds: PropTypes.instanceOf(Set).isRequired,
  disabled: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  onToggleAdapter: PropTypes.func.isRequired
};

export default ServiceCatalogTable;

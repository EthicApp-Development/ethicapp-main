import PropTypes from 'prop-types';
import { Form } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { adaptersByScope } from './aiServicesFormat.js';

// The EthicApp adapters one AI Additions service enables, grouped by scope
// (case analyses, design analyses, responses, chat), each with a switch
// (#864). A switch only works while its service is allowed: a version
// switches adapters off within the services it allows.
function AdapterSwitches({ service, serviceAllowed, disabledAdapterIds, disabled, onToggle }) {
  const { t } = useI18n();
  const groups = adaptersByScope(service.adapters || []);

  if (groups.length === 0) {
    return <span className="text-body-secondary">{t('pages.aiServices.services.noAdapters')}</span>;
  }

  return (
    <div className="small" data-testid={`ai-adapters-${service.id}`}>
      {groups.map((group) => (
        <div key={group.scope} className="mb-2">
          <div className="fw-semibold text-body-secondary">
            {t(`pages.aiServices.services.scopes.${group.scope}`)}
          </div>
          {group.adapters.map((adapter) => {
            const name = adapter.label || adapter.id;
            return (
              <Form.Check
                key={adapter.id}
                type="switch"
                id={`ai-adapter-enabled-${service.id}-${group.scope}-${adapter.id}`}
                checked={serviceAllowed && !disabledAdapterIds.has(adapter.id)}
                disabled={disabled || !serviceAllowed}
                onChange={() => onToggle(adapter.id)}
                aria-label={t('pages.aiServices.services.enableAdapter', { name })}
                label={(
                  <>
                    <span>{name}</span>
                    {' '}
                    <code className="text-body-secondary">{adapter.id}</code>
                    {adapter.description ? <div className="text-body-secondary">{adapter.description}</div> : null}
                  </>
                )}
              />
            );
          })}
        </div>
      ))}
      {serviceAllowed ? null : (
        <div className="text-body-secondary fst-italic">{t('pages.aiServices.services.adapterNeedsService')}</div>
      )}
    </div>
  );
}

AdapterSwitches.propTypes = {
  service: PropTypes.shape({
    id: PropTypes.string.isRequired,
    adapters: PropTypes.arrayOf(PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string,
      description: PropTypes.string,
      scopes: PropTypes.arrayOf(PropTypes.string)
    }))
  }).isRequired,
  serviceAllowed: PropTypes.bool.isRequired,
  disabledAdapterIds: PropTypes.instanceOf(Set).isRequired,
  disabled: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired
};

export default AdapterSwitches;

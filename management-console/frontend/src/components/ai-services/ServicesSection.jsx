import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Card, Form, Spinner } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import { aiErrorKey } from './aiServicesFormat.js';
import ServiceCatalogTable from './ServiceCatalogTable.jsx';

const MAX_NOTE_LENGTH = 1000;

function saveErrorText(error, t) {
  if (error.code === 'UNKNOWN_SERVICE_IDS') {
    return t('pages.aiServices.services.errors.unknownIds', { ids: (error.body?.unknownServiceIds || []).join(', ') });
  }
  if (error.code === 'CATALOG_UNAVAILABLE') {
    return `${t('pages.aiServices.services.errors.catalogUnavailable')} ${t(aiErrorKey(error.body?.catalogError))}`;
  }
  return t('pages.aiServices.services.saveError');
}

// Allowed-services editor. Saving appends a new policy version; the page
// remounts this section (keyed by the current version id) after each save.
function ServicesSection({ hasConnection, catalogState, currentVersion, onSave, onRetryCatalog }) {
  const { t } = useI18n();
  const currentIds = currentVersion?.allowedServiceIds || [];
  const [selectedIds, setSelectedIds] = useState(() => new Set(currentIds));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const catalog = catalogState.result;
  const catalogOk = catalog?.ok === true;
  const catalogIds = new Set(catalogOk ? catalog.services.map((service) => service.id) : []);
  const staleIds = catalogOk ? currentIds.filter((id) => !catalogIds.has(id)) : [];

  function toggle(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function save(allowedServiceIds) {
    setSaving(true);
    setFeedback(null);
    try {
      await onSave({ allowedServiceIds, note });
    } catch (error) {
      setFeedback(saveErrorText(error, t));
      setSaving(false);
    }
  }

  const saveSelection = (event) => {
    event.preventDefault();
    return save([...selectedIds].filter((id) => catalogIds.has(id)));
  };

  const noteField = (
    <Form.Group className="mb-3" controlId="ai-policy-note">
      <Form.Label>{t('pages.aiServices.services.note')}</Form.Label>
      <Form.Control
        as="textarea"
        rows={2}
        maxLength={MAX_NOTE_LENGTH}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={t('pages.aiServices.services.notePlaceholder')}
        disabled={saving}
      />
    </Form.Group>
  );

  // Without a readable catalog, the only change the backend accepts is an
  // empty set, so an operator can always turn every service off.
  const disallowAll = !catalogOk && currentIds.length > 0 ? (
    <div className="border rounded p-3" data-testid="ai-disallow-all">
      <p className="mb-2">{t('pages.aiServices.services.disallowAllHelp')}</p>
      {noteField}
      <Button variant="outline-danger" onClick={() => save([])} disabled={saving}>
        {saving ? <Spinner size="sm" className="me-2" /> : null}
        {t('pages.aiServices.services.disallowAll')}
      </Button>
    </div>
  ) : null;

  return (
    <Card className="mb-4" as="section" aria-labelledby="ai-services-heading">
      <Card.Body>
        <Card.Title id="ai-services-heading" className="d-flex align-items-center gap-2">
          <i className="fa-solid fa-robot text-primary" aria-hidden="true" />
          {t('pages.aiServices.services.heading')}
        </Card.Title>
        <Card.Text className="text-body-secondary">{t('pages.aiServices.services.description')}</Card.Text>
        <Alert variant="info" className="small">
          <i className="fa-solid fa-circle-info me-2" aria-hidden="true" />
          {t('pages.aiServices.services.launchNotice')}
        </Alert>

        {feedback ? <Alert variant="danger">{feedback}</Alert> : null}

        {!hasConnection ? <p className="text-body-secondary">{t('pages.aiServices.services.noConnection')}</p> : null}

        {hasConnection && catalogState.loading ? (
          <div className="d-flex align-items-center gap-2 mb-3">
            <Spinner size="sm" />
            <span>{t('pages.aiServices.services.loading')}</span>
          </div>
        ) : null}

        {hasConnection && !catalogState.loading && catalog && !catalogOk ? (
          <Alert variant="warning" data-testid="ai-catalog-error">
            <div>{t(aiErrorKey(catalog.error))}</div>
            <Button variant="outline-secondary" size="sm" className="mt-2" onClick={onRetryCatalog}>
              {t('pages.aiServices.services.retry')}
            </Button>
          </Alert>
        ) : null}

        {disallowAll}

        {catalogOk ? (
          <Form onSubmit={saveSelection}>
            {catalog.services.length === 0
              ? <p className="text-body-secondary">{t('pages.aiServices.services.empty')}</p>
              : <ServiceCatalogTable services={catalog.services} selectedIds={selectedIds} disabled={saving} onToggle={toggle} />}
            {staleIds.length > 0 ? (
              <Alert variant="warning" className="small">
                {t('pages.aiServices.services.staleIds', { ids: staleIds.join(', ') })}
              </Alert>
            ) : null}
            {noteField}
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner size="sm" className="me-2" /> : null}
              {t('pages.aiServices.services.save')}
            </Button>
          </Form>
        ) : null}
      </Card.Body>
    </Card>
  );
}

ServicesSection.propTypes = {
  hasConnection: PropTypes.bool.isRequired,
  catalogState: PropTypes.shape({
    loading: PropTypes.bool.isRequired,
    result: PropTypes.shape({
      ok: PropTypes.bool.isRequired,
      error: PropTypes.string,
      services: PropTypes.array
    })
  }).isRequired,
  currentVersion: PropTypes.shape({
    id: PropTypes.number.isRequired,
    allowedServiceIds: PropTypes.arrayOf(PropTypes.string).isRequired
  }),
  onSave: PropTypes.func.isRequired,
  onRetryCatalog: PropTypes.func.isRequired
};

export default ServicesSection;

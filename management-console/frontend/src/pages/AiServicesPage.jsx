import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Card, Spinner } from 'react-bootstrap';

import { useI18n } from '../app/providers.jsx';
import {
  createPolicyVersion,
  fetchCatalog,
  fetchConnection,
  fetchPolicy,
  removeConnection,
  saveConnection,
  testConnection
} from '../api/aiServicesApi.js';
import ConnectionSection from '../components/ai-services/ConnectionSection.jsx';
import {
  removeConnectionConfirmation,
  saveConnectionConfirmation,
  savePolicyConfirmation
} from '../components/ai-services/aiServicesConfirmations.js';
import HistorySection from '../components/ai-services/HistorySection.jsx';
import ServicesSection from '../components/ai-services/ServicesSection.jsx';
import { adapterNamesById, serviceNamesById } from '../components/ai-services/aiServicesFormat.js';
import { IDLE_CATALOG, connectionKeyOf, createCatalogLoader } from '../components/ai-services/catalogLoader.js';
import SensitiveActionConfirmModal from '../components/common/SensitiveActionConfirmModal.jsx';
import { useSensitiveActionConfirmation } from '../components/common/useSensitiveActionConfirmation.js';

// AI services page (epic #810): the AI Additions connection, the allowed
// services and the adapters switched off among them (#864), saved as
// append-only policy versions, and their history. This
// component only loads data and wires handlers; each section renders itself.
// Every write first asks for the administrator's step-up confirmation (#841);
// the write handlers resolve to a falsy value when it is cancelled.
function AiServicesPage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [connection, setConnection] = useState(null);
  const [policy, setPolicy] = useState({ current: null, versions: [] });
  const [catalogState, setCatalogState] = useState(IDLE_CATALOG);
  const [policySaved, setPolicySaved] = useState(false);
  const [catalogLoader] = useState(() => createCatalogLoader({ fetchCatalog, setState: setCatalogState }));
  const { requestConfirmation, modalProps } = useSensitiveActionConfirmation();

  const loadCatalogFor = useCallback((targetConnection) => catalogLoader.load({
    connectionKey: connectionKeyOf(targetConnection),
    locale
  }), [catalogLoader, locale]);

  useEffect(() => () => catalogLoader.dispose(), [catalogLoader]);

  useEffect(() => {
    let active = true;

    Promise.all([fetchConnection(), fetchPolicy()])
      .then(([loadedConnection, loadedPolicy]) => {
        if (!active) {
          return;
        }
        setConnection(loadedConnection);
        setPolicy(loadedPolicy);
        setLoading(false);
        if (loadedConnection) {
          loadCatalogFor(loadedConnection);
        }
      })
      .catch(() => {
        if (active) {
          setLoadError(t('pages.aiServices.loadError'));
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [loadCatalogFor, t]);

  // Defense in depth: show a catalog only for the connection it was read for.
  const currentCatalog = catalogState.connectionKey === connectionKeyOf(connection)
    ? catalogState
    : IDLE_CATALOG;

  const catalogServices = currentCatalog.result?.ok ? currentCatalog.result.services : null;
  const namesById = useMemo(() => serviceNamesById(catalogServices || []), [catalogServices]);
  const adapterNames = useMemo(() => adapterNamesById(catalogServices || []), [catalogServices]);

  const handleSaveConnection = useCallback(async (values) => {
    const outcome = await requestConfirmation(saveConnectionConfirmation({ t, values, saveConnection }));
    if (!outcome.confirmed) {
      return null;
    }

    const saved = outcome.result;
    setConnection(saved);
    loadCatalogFor(saved);
    return saved;
  }, [loadCatalogFor, requestConfirmation, t]);

  const handleRemoveConnection = useCallback(async () => {
    const outcome = await requestConfirmation(removeConnectionConfirmation({ t, removeConnection }));
    if (!outcome.confirmed) {
      return false;
    }

    setConnection(null);
    catalogLoader.reset();
    return true;
  }, [catalogLoader, requestConfirmation, t]);

  const handleSavePolicy = useCallback(async (input) => {
    const outcome = await requestConfirmation(savePolicyConfirmation({
      t, input, namesById, adapterNamesById: adapterNames, createPolicyVersion
    }));
    if (!outcome.confirmed) {
      return false;
    }

    setPolicy(await fetchPolicy());
    setPolicySaved(true);
    return true;
  }, [adapterNames, namesById, requestConfirmation, t]);

  return (
    <>
      <Card className="mb-4">
        <Card.Body>
          <Card.Title className="d-flex align-items-center gap-2">
            <i className="fa-solid fa-wand-magic-sparkles text-primary" aria-hidden="true" />
            <h1 className="h5 mb-0">{t('pages.aiServices.heading')}</h1>
          </Card.Title>
          <Card.Text className="mb-0">{t('pages.aiServices.description')}</Card.Text>
        </Card.Body>
      </Card>

      {loadError ? <Alert variant="danger">{loadError}</Alert> : null}

      {loading ? (
        <div className="d-flex align-items-center gap-2">
          <Spinner size="sm" />
          <span>{t('pages.aiServices.loading')}</span>
        </div>
      ) : null}

      {!loading && !loadError ? (
        <>
          <ConnectionSection
            connection={connection}
            onTest={testConnection}
            onSave={handleSaveConnection}
            onRemove={handleRemoveConnection}
          />
          {policySaved ? (
            <Alert variant="success" dismissible onClose={() => setPolicySaved(false)}>
              {t('pages.aiServices.services.saveSuccess', { version: policy.current?.id ?? '' })}
            </Alert>
          ) : null}
          <ServicesSection
            key={policy.current?.id ?? 'none'}
            hasConnection={Boolean(connection)}
            catalogState={currentCatalog}
            currentVersion={policy.current}
            onSave={handleSavePolicy}
            onRetryCatalog={() => loadCatalogFor(connection)}
          />
          <HistorySection versions={policy.versions} namesById={namesById} adapterNamesById={adapterNames} />
        </>
      ) : null}

      <SensitiveActionConfirmModal {...modalProps} />
    </>
  );
}

export default AiServicesPage;

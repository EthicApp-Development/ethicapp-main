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
import HistorySection from '../components/ai-services/HistorySection.jsx';
import ServicesSection from '../components/ai-services/ServicesSection.jsx';
import { serviceNamesById } from '../components/ai-services/aiServicesFormat.js';

const IDLE_CATALOG = { loading: false, result: null };

// AI services page (epic #810): the AI Additions connection, the allowed
// services saved as append-only policy versions, and their history. This
// component only loads data and wires handlers; each section renders itself.
function AiServicesPage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [connection, setConnection] = useState(null);
  const [policy, setPolicy] = useState({ current: null, versions: [] });
  const [catalogState, setCatalogState] = useState(IDLE_CATALOG);
  const [policySaved, setPolicySaved] = useState(false);

  const loadCatalog = useCallback(async () => {
    setCatalogState({ loading: true, result: null });
    try {
      setCatalogState({ loading: false, result: await fetchCatalog(locale) });
    } catch {
      setCatalogState({ loading: false, result: { ok: false, error: 'generic' } });
    }
  }, [locale]);

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
          loadCatalog();
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
  }, [loadCatalog, t]);

  const handleSaveConnection = useCallback(async (values) => {
    const saved = await saveConnection(values);
    setConnection(saved);
    loadCatalog();
    return saved;
  }, [loadCatalog]);

  const handleRemoveConnection = useCallback(async () => {
    await removeConnection();
    setConnection(null);
    setCatalogState(IDLE_CATALOG);
  }, []);

  const handleSavePolicy = useCallback(async (input) => {
    await createPolicyVersion(input);
    setPolicy(await fetchPolicy());
    setPolicySaved(true);
  }, []);

  const namesById = useMemo(
    () => serviceNamesById(catalogState.result?.ok ? catalogState.result.services : []),
    [catalogState.result]
  );

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
            catalogState={catalogState}
            currentVersion={policy.current}
            onSave={handleSavePolicy}
            onRetryCatalog={loadCatalog}
          />
          <HistorySection versions={policy.versions} namesById={namesById} />
        </>
      ) : null}
    </>
  );
}

export default AiServicesPage;

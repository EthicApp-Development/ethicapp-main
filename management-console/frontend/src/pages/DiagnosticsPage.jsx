import PropTypes from 'prop-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Spinner } from 'react-bootstrap';

import { useI18n } from '../app/providers.jsx';
import { runConnectivityCheck, runDnsCheck } from '../api/healthApi.js';
import CheckCard from '../components/diagnostics/CheckCard.jsx';
import ConnectivityResults from '../components/diagnostics/ConnectivityResults.jsx';
import DnsResults from '../components/diagnostics/DnsResults.jsx';

const TARGETS_VARIABLE = 'MNG_HEALTH_CHECK_TARGETS';
const INITIAL_CHECK_STATE = { loading: false, error: '', report: null };

function DiagnosticsPage() {
  const { t } = useI18n();
  const [dnsState, setDnsState] = useState(INITIAL_CHECK_STATE);
  const [connectivityState, setConnectivityState] = useState(INITIAL_CHECK_STATE);
  const isMountedRef = useRef(true);
  const running = dnsState.loading || connectivityState.loading;

  const runCheck = useCallback(async (run, setState) => {
    setState((current) => ({ ...current, loading: true, error: '' }));

    try {
      const report = await run();
      if (isMountedRef.current) {
        setState({ loading: false, error: '', report });
      }
    } catch {
      // A failed request keeps the previous report visible next to the error.
      if (isMountedRef.current) {
        setState((current) => ({ ...current, loading: false, error: t('pages.diagnostics.requestError') }));
      }
    }
  }, [t]);

  const runChecks = useCallback(() => Promise.all([
    runCheck(runDnsCheck, setDnsState),
    runCheck(runConnectivityCheck, setConnectivityState)
  ]), [runCheck]);

  useEffect(() => {
    isMountedRef.current = true;
    runChecks();

    return () => {
      isMountedRef.current = false;
    };
  }, [runChecks]);

  return (
    <DiagnosticsView
      dnsState={dnsState}
      connectivityState={connectivityState}
      running={running}
      onRun={runChecks}
    />
  );
}

const checkStateShape = PropTypes.shape({
  loading: PropTypes.bool.isRequired,
  error: PropTypes.string.isRequired,
  report: PropTypes.shape({
    targets: PropTypes.array.isRequired
  })
});

// Presentational part of the page, kept free of hooks other than i18n so it
// can be rendered with fixed check states in tests.
export function DiagnosticsView({ dnsState, connectivityState, running, onRun }) {
  const { t } = useI18n();
  // Both checks read the same allowlist, so one empty report means nothing is
  // configured. The notice is shown next to the check cards, never instead of
  // them, so request errors from either check stay visible.
  const noTargetsConfigured = [dnsState.report, connectivityState.report]
    .some((report) => report && report.targets.length === 0);

  return (
    <>
      <Card className="mb-4">
        <Card.Body>
          <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
            <div>
              <Card.Title className="d-flex align-items-center gap-2">
                <i className="fa-solid fa-stethoscope text-primary" aria-hidden="true" />
                <span>{t('pages.diagnostics.heading')}</span>
              </Card.Title>
              <Card.Text className="mb-0">{t('pages.diagnostics.description')}</Card.Text>
            </div>
            <Button onClick={onRun} disabled={running}>
              {running ? (
                <Spinner size="sm" className="me-2" />
              ) : (
                <i className="fa-solid fa-rotate me-2" aria-hidden="true" />
              )}
              {t('pages.diagnostics.actions.run')}
            </Button>
          </div>
          <Alert variant="secondary" className="small mt-3 mb-0">
            <i className="fa-solid fa-circle-info me-2" aria-hidden="true" />
            {t('pages.diagnostics.vantagePoint')}
          </Alert>
        </Card.Body>
      </Card>

      {noTargetsConfigured ? (
        <Alert variant="info">
          {t('pages.diagnostics.noTargets', { variable: TARGETS_VARIABLE })}
        </Alert>
      ) : null}

      <CheckCard
        icon="fa-signs-post"
        title={t('pages.diagnostics.dns.heading')}
        description={t('pages.diagnostics.dns.description')}
        state={dnsState}
      >
        {dnsState.report ? <DnsResults report={dnsState.report} /> : null}
      </CheckCard>

      <CheckCard
        icon="fa-network-wired"
        title={t('pages.diagnostics.connectivity.heading')}
        description={t('pages.diagnostics.connectivity.description')}
        state={connectivityState}
      >
        {connectivityState.report?.targets.length > 0 ? (
          <ConnectivityResults report={connectivityState.report} />
        ) : null}
      </CheckCard>
    </>
  );
}

DiagnosticsView.propTypes = {
  dnsState: checkStateShape.isRequired,
  connectivityState: checkStateShape.isRequired,
  running: PropTypes.bool.isRequired,
  onRun: PropTypes.func.isRequired
};

export default DiagnosticsPage;

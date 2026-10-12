import PropTypes from 'prop-types';
import { Alert, Table } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import ErrorCode from './ErrorCode.jsx';
import { formatDateTime, formatLatency } from './formatters.js';
import StatusBadge, { statusOf } from './StatusBadge.jsx';
import TargetCell from './TargetCell.jsx';

const STAGES = ['dns', 'tcp', 'tls'];

function StageDetail({ stage, result }) {
  const { t, locale } = useI18n();

  if (stage === 'tcp' && result.address) {
    return <div className="small text-body-secondary text-break">{result.address}</div>;
  }

  if (stage === 'tls' && result.ok) {
    return (
      <div className="small text-body-secondary">
        <div>{result.protocol}</div>
        {result.certificate ? (
          <div>
            {t('pages.diagnostics.connectivity.certificate', {
              issuer: result.certificate.issuer ?? '—',
              validTo: formatDateTime(result.certificate.validTo, locale)
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}

StageDetail.propTypes = {
  stage: PropTypes.oneOf(STAGES).isRequired,
  result: PropTypes.object.isRequired
};

function StageCell({ stage, result }) {
  const { t } = useI18n();

  if (!result) {
    return <span className="small text-body-secondary">{t('pages.diagnostics.connectivity.notRun')}</span>;
  }

  return (
    <>
      <div className="d-flex align-items-center gap-2">
        <StatusBadge status={statusOf(result)} />
        <span className="small text-body-secondary text-nowrap">{formatLatency(result.latencyMs)}</span>
      </div>
      <StageDetail stage={stage} result={result} />
    </>
  );
}

StageCell.propTypes = {
  stage: PropTypes.oneOf(STAGES).isRequired,
  result: PropTypes.object
};

function ConnectivityResults({ report }) {
  const { t } = useI18n();

  return (
    <>
      {report.deadlineExceeded ? (
        <Alert variant="warning">{t('pages.diagnostics.connectivity.deadlineExceeded')}</Alert>
      ) : null}

      <Table responsive className="align-middle mb-0">
        <thead>
          <tr>
            <th>{t('pages.diagnostics.columns.target')}</th>
            <th>{t('pages.diagnostics.connectivity.columns.result')}</th>
            {STAGES.map((stage) => (
              <th key={stage}>{t(`pages.diagnostics.connectivity.stages.${stage}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.targets.map((target) => (
            <tr key={target.label}>
              <td><TargetCell target={target} /></td>
              <td>
                <StatusBadge status={target.reachable ? 'ok' : 'failed'} />
                {target.failedStage ? (
                  <div className="small mt-1">
                    {t('pages.diagnostics.connectivity.failedAt', {
                      stage: t(`pages.diagnostics.connectivity.stages.${target.failedStage}`)
                    })}
                  </div>
                ) : null}
                <ErrorCode code={target.error} />
              </td>
              {STAGES.map((stage) => (
                <td key={stage}><StageCell stage={stage} result={target.stages[stage]} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

ConnectivityResults.propTypes = {
  report: PropTypes.shape({
    deadlineExceeded: PropTypes.bool.isRequired,
    targets: PropTypes.arrayOf(PropTypes.shape({
      label: PropTypes.string.isRequired,
      host: PropTypes.string.isRequired,
      port: PropTypes.number.isRequired,
      reachable: PropTypes.bool.isRequired,
      failedStage: PropTypes.oneOf([...STAGES, null]),
      error: PropTypes.string,
      stages: PropTypes.shape({
        dns: PropTypes.object,
        tcp: PropTypes.object,
        tls: PropTypes.object
      }).isRequired
    })).isRequired
  }).isRequired
};

export default ConnectivityResults;

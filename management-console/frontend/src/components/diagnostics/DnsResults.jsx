import PropTypes from 'prop-types';
import { Table } from 'react-bootstrap';

import { useI18n } from '../../app/providers.jsx';
import ErrorCode from './ErrorCode.jsx';
import { formatAddressList, formatLatency } from './formatters.js';
import StatusBadge, { statusOf } from './StatusBadge.jsx';
import TargetCell from './TargetCell.jsx';

function ResolutionCell({ result }) {
  return (
    <>
      <div className="d-flex align-items-center gap-2">
        <StatusBadge status={statusOf(result)} />
        <span className="small text-body-secondary text-nowrap">{formatLatency(result.latencyMs)}</span>
      </div>
      <ErrorCode code={result.error} />
      {result.addresses.length > 0 ? (
        <div className="small text-body-secondary text-break">{formatAddressList(result.addresses)}</div>
      ) : null}
    </>
  );
}

const resolutionShape = PropTypes.shape({
  ok: PropTypes.bool.isRequired,
  skipped: PropTypes.bool,
  addresses: PropTypes.arrayOf(PropTypes.string).isRequired,
  latencyMs: PropTypes.number,
  error: PropTypes.string
});

ResolutionCell.propTypes = {
  result: resolutionShape.isRequired
};

function DnsResults({ report }) {
  const { t } = useI18n();
  const upstreamServers = report.upstreamServers === null
    ? t('pages.diagnostics.dns.upstreamUnknown')
    : formatAddressList(report.upstreamServers);

  return (
    <>
      <dl className="row small mb-0">
        <dt className="col-sm-4">{t('pages.diagnostics.dns.containerResolvers')}</dt>
        <dd className="col-sm-8 text-break">{formatAddressList(report.servers)}</dd>
        <dt className="col-sm-4">{t('pages.diagnostics.dns.upstreamResolvers')}</dt>
        <dd className="col-sm-8 text-break">{upstreamServers}</dd>
      </dl>

      {/* Resolvers are useful even before any target is configured. */}
      {report.targets.length > 0 ? (
        <Table responsive className="align-middle mt-3 mb-0">
          <thead>
            <tr>
              <th>{t('pages.diagnostics.columns.target')}</th>
              <th>{t('pages.diagnostics.dns.columns.lookup')}</th>
              <th>{t('pages.diagnostics.dns.columns.resolve')}</th>
            </tr>
          </thead>
          <tbody>
            {report.targets.map((target) => (
              <tr key={target.label}>
                <td><TargetCell target={target} /></td>
                <td><ResolutionCell result={target.lookup} /></td>
                <td><ResolutionCell result={target.resolve} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </>
  );
}

DnsResults.propTypes = {
  report: PropTypes.shape({
    servers: PropTypes.arrayOf(PropTypes.string).isRequired,
    upstreamServers: PropTypes.arrayOf(PropTypes.string),
    targets: PropTypes.arrayOf(PropTypes.shape({
      label: PropTypes.string.isRequired,
      host: PropTypes.string.isRequired,
      port: PropTypes.number.isRequired,
      lookup: resolutionShape.isRequired,
      resolve: resolutionShape.isRequired
    })).isRequired
  }).isRequired
};

export default DnsResults;

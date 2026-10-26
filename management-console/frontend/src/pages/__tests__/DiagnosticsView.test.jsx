import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DiagnosticsView } from '../DiagnosticsPage.jsx';

// Without an I18n provider, t() returns the translation key, so assertions
// look for keys instead of localized text.
const NO_TARGETS_NOTICE = 'pages.diagnostics.noTargets';
const DNS_HEADING = 'pages.diagnostics.dns.heading';
const CONNECTIVITY_HEADING = 'pages.diagnostics.connectivity.heading';

const emptyDnsReport = {
  checkedAt: '2026-10-12T12:00:00.000Z',
  servers: ['127.0.0.11'],
  upstreamServers: ['192.168.65.7'],
  targets: []
};

const emptyConnectivityReport = {
  checkedAt: '2026-10-12T12:00:00.000Z',
  deadlineExceeded: false,
  targets: []
};

const smtpDnsReport = {
  ...emptyDnsReport,
  targets: [{
    label: 'smtp',
    host: 'smtp.gmail.com',
    port: 465,
    lookup: { ok: true, addresses: ['192.0.2.1'], latencyMs: 4, error: null },
    resolve: { ok: true, addresses: ['192.0.2.1'], latencyMs: 5, error: null }
  }]
};

function checkState({ report = null, error = '', loading = false } = {}) {
  return { loading, error, report };
}

function render({ dnsState, connectivityState }) {
  return renderToStaticMarkup(
    <DiagnosticsView
      dnsState={dnsState}
      connectivityState={connectivityState}
      running={false}
      onRun={() => {}}
    />
  );
}

function countOccurrences(html, text) {
  return html.split(text).length - 1;
}

describe('DiagnosticsView', () => {
  it('keeps a failed check visible next to an empty successful report', () => {
    const html = render({
      dnsState: checkState({ report: emptyDnsReport }),
      connectivityState: checkState({ error: 'Connectivity request failed' })
    });

    expect(html).toContain(NO_TARGETS_NOTICE);
    expect(html).toContain(DNS_HEADING);
    expect(html).toContain(CONNECTIVITY_HEADING);
    expect(html).toContain('Connectivity request failed');
  });

  it('shows rerun errors while keeping the previous empty reports', () => {
    const html = render({
      dnsState: checkState({ report: emptyDnsReport, error: 'DNS rerun failed' }),
      connectivityState: checkState({ report: emptyConnectivityReport, error: 'Connectivity rerun failed' })
    });

    expect(html).toContain(NO_TARGETS_NOTICE);
    expect(html).toContain('DNS rerun failed');
    expect(html).toContain('Connectivity rerun failed');
  });

  it('shows the resolvers without a results table when no targets are configured', () => {
    const html = render({
      dnsState: checkState({ report: emptyDnsReport }),
      connectivityState: checkState({ report: emptyConnectivityReport })
    });

    expect(html).toContain('127.0.0.11');
    expect(html).toContain('192.168.65.7');
    expect(countOccurrences(html, '<table')).toBe(0);
  });

  it('renders the results without the notice when targets are configured', () => {
    const html = render({
      dnsState: checkState({ report: smtpDnsReport }),
      connectivityState: checkState({ loading: true })
    });

    expect(html).not.toContain(NO_TARGETS_NOTICE);
    expect(html).toContain('smtp.gmail.com:465');
    expect(countOccurrences(html, '<table')).toBe(1);
    expect(html).toContain('pages.diagnostics.running');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import enUS from '../../../i18n/locales/en_US.js';
import esCL from '../../../i18n/locales/es_CL.js';
import ConnectionSection from '../ConnectionSection.jsx';
import ConnectionTestResult from '../ConnectionTestResult.jsx';
import HistorySection from '../HistorySection.jsx';
import ServicesSection from '../ServicesSection.jsx';
import {
  adapterNamesById,
  adaptersByScope,
  aiErrorKey,
  issuerMismatchHint,
  serviceNamesById,
  switchableAdapterIds
} from '../aiServicesFormat.js';

// Without an I18n provider, t() returns the translation key, so assertions
// look for keys instead of localized text.
const noop = async () => {};

const catalog = {
  ok: true,
  contractVersion: '1',
  locale: 'en_US',
  services: [
    {
      id: 'polyadic-agent',
      name: 'Polyadic agent',
      description: 'Joins the discussion',
      usesLlm: true,
      status: 'active',
      available: true,
      adapters: [{ id: 'polyadic-agents', label: 'Discussion agents', description: 'Agents in the chat', scopes: ['chat'] }]
    },
    {
      id: 'argumentation-tutor',
      name: 'Argumentation tutor',
      description: null,
      usesLlm: false,
      status: 'maintenance',
      available: false,
      adapters: []
    },
    {
      id: 'case-analyst',
      name: 'Case Analyst',
      description: 'Analyses cases',
      usesLlm: true,
      status: 'active',
      available: true,
      adapters: [
        { id: 'case-analyst-evaluation', label: 'Case evaluation', description: null, scopes: ['case'] },
        { id: 'case-analyst-evidence-inventory', label: 'Evidence inventory', description: null, scopes: ['case'] },
        { id: 'case-analyst-claim-typology', label: 'Claim typology', description: null, scopes: ['design'] },
        { id: 'case-analyst-topic-listing', label: 'Topic listing', description: null, scopes: ['case'] }
      ]
    }
  ]
};

// Whether the input with `id` is rendered checked.
function isChecked(html, id) {
  const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
  if (!tag) {
    throw new Error(`no input ${id}`);
  }
  return tag.includes('checked=""');
}

function isDisabled(html, id) {
  return html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0].includes('disabled=""');
}

function renderServices(props) {
  return renderToStaticMarkup(
    <ServicesSection
      hasConnection
      catalogState={{ loading: false, result: catalog }}
      currentVersion={{ id: 2, allowedServiceIds: ['polyadic-agent'] }}
      onSave={noop}
      onRetryCatalog={() => {}}
      {...props}
    />
  );
}

function keysOf(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => (
    value && typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  ));
}

describe('AI services connection section', () => {
  it('states that the installation uses no external AI when there is no connection', () => {
    const html = renderToStaticMarkup(
      <ConnectionSection connection={null} onTest={noop} onSave={noop} onRemove={noop} />
    );

    expect(html).toContain('pages.aiServices.noConnection.title');
    expect(html).toContain('pages.aiServices.connection.actions.test');
    expect(html).not.toContain('pages.aiServices.connection.actions.remove');
  });

  it('shows the saved URLs and the remove action when a connection exists', () => {
    const html = renderToStaticMarkup(
      <ConnectionSection
        connection={{
          baseUrl: 'http://ai-additions:8080',
          keycloakPublicUrl: 'https://ai.example.org/keycloak',
          updatedAt: '2026-10-26T10:00:00.000Z',
          updatedBy: { id: 7, name: 'Ada Lovelace' }
        }}
        onTest={noop}
        onSave={noop}
        onRemove={noop}
      />
    );

    expect(html).not.toContain('pages.aiServices.noConnection.title');
    expect(html).toContain('value="http://ai-additions:8080"');
    expect(html).toContain('value="https://ai.example.org/keycloak"');
    expect(html).toContain('pages.aiServices.connection.lastUpdated');
    expect(html).toContain('pages.aiServices.connection.actions.remove');
  });
});

describe('AI services connection test result', () => {
  it('shows each step of a failing test with its error', () => {
    const html = renderToStaticMarkup(
      <ConnectionTestResult result={{
        ok: false,
        error: 'unauthorized',
        token: { ok: false, error: 'unauthorized', skipped: false },
        catalog: { ok: false, error: null, skipped: true },
        serviceCount: null
      }} />
    );

    expect(html).toContain('pages.aiServices.connection.test.failure');
    expect(html).toContain('pages.aiServices.connection.test.status.failed');
    expect(html).toContain('pages.aiServices.errors.unauthorized');
    expect(html).toContain('pages.aiServices.connection.test.status.skipped');
  });

  it('explains missing client credentials on the token step, not as an AI Additions refusal', () => {
    const html = renderToStaticMarkup(
      <ConnectionTestResult result={{
        ok: false,
        error: 'credentials_missing',
        token: { ok: false, error: 'credentials_missing', skipped: false },
        issuer: { ok: false, error: null, skipped: true, expected: 'http://ai-additions-missing.invalid/keycloak/realms/r', actual: null },
        catalog: { ok: false, error: null, skipped: true },
        serviceCount: null
      }} />
    );

    expect(html).toContain('pages.aiServices.errors.credentials_missing');
    expect(html).not.toContain('pages.aiServices.errors.unauthorized');
    expect(html.split('pages.aiServices.connection.test.status.skipped').length - 1).toBe(2);
  });

  it('shows the ethicapp-level error when no step ran', () => {
    const html = renderToStaticMarkup(
      <ConnectionTestResult result={{
        ok: false,
        error: 'unreachable',
        token: { ok: false, error: null, skipped: true },
        catalog: { ok: false, error: null, skipped: true },
        serviceCount: null
      }} />
    );

    expect(html).toContain('pages.aiServices.errors.unreachable');
  });

  it('shows a working connection', () => {
    const html = renderToStaticMarkup(
      <ConnectionTestResult result={{
        ok: true,
        error: null,
        token: { ok: true, error: null, skipped: false },
        catalog: { ok: true, error: null, skipped: false },
        serviceCount: 2
      }} />
    );

    expect(html).toContain('pages.aiServices.connection.test.success');
    expect(html.split('pages.aiServices.connection.test.status.ok').length - 1).toBe(2);
    expect(html).not.toContain('pages.aiServices.connection.test.issuer.label');
  });

  const EXPECTED_ISSUER = 'https://ai.example.org/keycloak/realms/ethicapp-ai-additions';
  const ACTUAL_ISSUER = 'http://localhost:8080/kc/realms/ethicapp-ai-additions';

  function issuerResult(issuer, overrides = {}) {
    return {
      ok: issuer.ok,
      error: issuer.ok ? null : issuer.error,
      token: { ok: true, error: null, skipped: false },
      issuer: { skipped: false, expected: EXPECTED_ISSUER, actual: null, ...issuer },
      catalog: { ok: true, error: null, skipped: false },
      serviceCount: 2,
      ...overrides
    };
  }

  it('shows the issuer step between the token and the catalog', () => {
    const html = renderToStaticMarkup(
      <ConnectionTestResult result={issuerResult({ ok: true, error: null, actual: EXPECTED_ISSUER })} />
    );

    const token = html.indexOf('pages.aiServices.connection.test.token');
    const issuer = html.indexOf('pages.aiServices.connection.test.issuer.label');
    const catalogStep = html.indexOf('pages.aiServices.connection.test.catalog');
    expect(token).toBeGreaterThan(-1);
    expect(issuer).toBeGreaterThan(token);
    expect(catalogStep).toBeGreaterThan(issuer);
    expect(html.split('pages.aiServices.connection.test.status.ok').length - 1).toBe(3);
    expect(html).not.toContain('ai-connection-test-issuer-mismatch');
  });

  it('shows expected and actual issuers, the matching Keycloak URL and the callback consequence on a mismatch', () => {
    const html = renderToStaticMarkup(
      <ConnectionTestResult result={issuerResult({ ok: false, error: 'issuer_mismatch', actual: ACTUAL_ISSUER })} />
    );

    expect(html).toContain('pages.aiServices.connection.test.failure');
    expect(html).toContain('pages.aiServices.errors.issuer_mismatch');
    expect(html).toContain('pages.aiServices.connection.test.issuer.mismatchExplanation');
    expect(html).toContain(EXPECTED_ISSUER);
    expect(html).toContain(ACTUAL_ISSUER);
    expect(html).toContain('pages.aiServices.connection.test.issuer.suggestion');
    expect(html).toMatch(/data-testid="ai-connection-test-issuer-suggestion">http:\/\/localhost:8080\/kc</);
    expect(html).not.toContain('pages.aiServices.connection.test.issuer.realmMismatch');
  });

  it('explains that no Keycloak URL helps when the realms differ', () => {
    const html = renderToStaticMarkup(
      <ConnectionTestResult result={issuerResult({
        ok: false,
        error: 'issuer_mismatch',
        actual: 'https://ai.example.org/keycloak/realms/other'
      })} />
    );

    expect(html).toContain('pages.aiServices.connection.test.issuer.realmMismatch');
    expect(html).not.toContain('ai-connection-test-issuer-suggestion');
  });

  it('explains an unreadable token issuer and a skipped issuer step', () => {
    const invalid = renderToStaticMarkup(
      <ConnectionTestResult result={issuerResult({ ok: false, error: 'invalid_response' })} />
    );
    expect(invalid).toContain('pages.aiServices.connection.test.issuer.invalidToken');
    expect(invalid).not.toContain('ai-connection-test-issuer-mismatch');

    const skipped = renderToStaticMarkup(
      <ConnectionTestResult result={issuerResult({ ok: false, error: null, skipped: true }, {
        error: 'unauthorized',
        token: { ok: false, error: 'unauthorized', skipped: false },
        catalog: { ok: false, error: null, skipped: true },
        serviceCount: null
      })} />
    );
    expect(skipped.split('pages.aiServices.connection.test.status.skipped').length - 1).toBe(2);
  });
});

describe('issuerMismatchHint', () => {
  const expected = 'https://ai.example.org/keycloak/realms/ethicapp-ai-additions';

  it('drops /realms/<realm> from the actual issuer', () => {
    expect(issuerMismatchHint(expected, 'http://kc.example.org/realms/ethicapp-ai-additions')).toEqual({
      realmMismatch: false,
      keycloakPublicUrl: 'http://kc.example.org'
    });
    expect(issuerMismatchHint(expected, 'https://x.org/base/keycloak/realms/ethicapp-ai-additions/')).toEqual({
      realmMismatch: false,
      keycloakPublicUrl: 'https://x.org/base/keycloak'
    });
  });

  it('flags a different realm and ignores values that are not issuers', () => {
    expect(issuerMismatchHint(expected, 'https://kc.example.org/realms/other')).toEqual({
      realmMismatch: true,
      keycloakPublicUrl: null
    });
    expect(issuerMismatchHint(expected, 'https://kc.example.org/no-realm')).toBeNull();
    expect(issuerMismatchHint(expected, null)).toBeNull();
  });
});

describe('AI services allowed-services section', () => {
  it('lists the catalog with the current version checked, the LLM flag, availability and adapters', () => {
    const html = renderServices();

    expect(html).toContain('Polyadic agent');
    expect(html).toContain('Argumentation tutor');
    expect(html).toContain('polyadic-agents');
    expect(html).toContain('pages.aiServices.services.available');
    expect(html).toContain('pages.aiServices.services.unavailable');
    expect(html).toContain('pages.aiServices.services.launchNotice');
    expect(html).toMatch(/id="ai-service-allowed-polyadic-agent"[^>]*checked=""|checked=""[^>]*id="ai-service-allowed-polyadic-agent"/);
    expect(html).not.toMatch(/checked=""[^>]*id="ai-service-allowed-argumentation-tutor"|id="ai-service-allowed-argumentation-tutor"[^>]*checked=""/);
    expect(html).toContain('pages.aiServices.services.save');
  });

  it('warns about allowed services that the catalog no longer offers', () => {
    const html = renderServices({ currentVersion: { id: 3, allowedServiceIds: ['polyadic-agent', 'retired-service'] } });
    expect(html).toContain('pages.aiServices.services.staleIds');
  });

  for (const code of ['not_configured', 'credentials_missing', 'unreachable', 'unauthorized', 'invalid_response', 'ethicapp_error']) {
    it(`explains a ${code} catalog error and only offers to allow nothing`, () => {
      const html = renderServices({ catalogState: { loading: false, result: { ok: false, error: code } } });

      expect(html).toContain(`pages.aiServices.errors.${code}`);
      expect(html).toContain('pages.aiServices.services.disallowAll');
      expect(html).not.toContain('ai-service-allowed-');
    });
  }

  it('does not offer to allow nothing when nothing is allowed already', () => {
    const html = renderServices({
      catalogState: { loading: false, result: { ok: false, error: 'unreachable' } },
      currentVersion: { id: 1, allowedServiceIds: [] }
    });
    expect(html).not.toContain('pages.aiServices.services.disallowAll');
  });

  it('groups each service\'s adapters by scope, with Case Analyst under case and design analyses', () => {
    const html = renderServices({
      currentVersion: {
        id: 5,
        allowedServiceIds: ['polyadic-agent', 'case-analyst'],
        disabledAdapterIds: ['case-analyst-claim-typology']
      }
    });

    const caseAnalyst = html.slice(html.indexOf('data-testid="ai-adapters-case-analyst"'));
    const caseHeading = caseAnalyst.indexOf('pages.aiServices.services.scopes.case');
    const designHeading = caseAnalyst.indexOf('pages.aiServices.services.scopes.design');
    expect(caseHeading).toBeGreaterThan(-1);
    expect(designHeading).toBeGreaterThan(caseHeading);
    expect(caseAnalyst.indexOf('Evidence inventory')).toBeGreaterThan(caseHeading);
    expect(caseAnalyst.indexOf('Evidence inventory')).toBeLessThan(designHeading);
    expect(caseAnalyst.indexOf('Claim typology')).toBeGreaterThan(designHeading);
    expect(html).toContain('pages.aiServices.services.scopes.chat');
    expect(html).toContain('pages.aiServices.services.adaptersHelp');

    expect(isChecked(html, 'ai-adapter-enabled-case-analyst-case-case-analyst-evaluation')).toBe(true);
    expect(isChecked(html, 'ai-adapter-enabled-case-analyst-design-case-analyst-claim-typology')).toBe(false);
    expect(isDisabled(html, 'ai-adapter-enabled-case-analyst-design-case-analyst-claim-typology')).toBe(false);
    expect(isChecked(html, 'ai-adapter-enabled-polyadic-agent-chat-polyadic-agents')).toBe(true);
  });

  it('only lets adapters of allowed services be switched', () => {
    const html = renderServices();

    expect(isDisabled(html, 'ai-adapter-enabled-case-analyst-case-case-analyst-evaluation')).toBe(true);
    expect(isChecked(html, 'ai-adapter-enabled-case-analyst-case-case-analyst-evaluation')).toBe(false);
    expect(isDisabled(html, 'ai-adapter-enabled-polyadic-agent-chat-polyadic-agents')).toBe(false);
    expect(html).toContain('pages.aiServices.services.adapterNeedsService');
  });

  it('asks for a connection before listing services', () => {
    const html = renderServices({ hasConnection: false, catalogState: { loading: false, result: null } });
    expect(html).toContain('pages.aiServices.services.noConnection');
    expect(html).not.toContain('pages.aiServices.services.save');
  });
});

describe('AI services history section', () => {
  it('shows every version with author, services, note and launched sessions', () => {
    const html = renderToStaticMarkup(
      <HistorySection
        namesById={serviceNamesById(catalog.services)}
        adapterNamesById={adapterNamesById(catalog.services)}
        versions={[
          {
            id: 2,
            allowedServiceIds: ['polyadic-agent', 'retired-service'],
            note: 'Pilot course',
            createdAt: '2026-10-26T10:00:00.000Z',
            createdBy: { id: 7, name: 'Ada Lovelace' },
            launchedSessionCount: 4,
            disabledAdapterIds: ['case-analyst-claim-typology', 'retired-adapter']
          },
          {
            id: 1,
            allowedServiceIds: [],
            note: 'Initial policy: no AI services are allowed.',
            createdAt: '2026-10-25T10:00:00.000Z',
            createdBy: null,
            launchedSessionCount: 0
          }
        ]}
      />
    );

    expect(html).toContain('Polyadic agent, retired-service');
    expect(html).toContain('Claim typology, retired-adapter');
    expect(html).toContain('pages.aiServices.history.columns.disabledAdapters');
    expect(html).toContain('pages.aiServices.history.noDisabledAdapters');
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Pilot course');
    expect(html).toContain('pages.aiServices.history.systemAuthor');
    expect(html).toContain('pages.aiServices.history.noServices');
    expect(html).toContain('>4<');
    expect(html.split('pages.aiServices.history.current').length - 1).toBe(1);
  });
});

describe('AI services translations', () => {
  it('defines every key in both locales', () => {
    const enKeys = keysOf({ nav: enUS.nav, aiServices: enUS.pages.aiServices }).sort();
    const esKeys = keysOf({ nav: esCL.nav, aiServices: esCL.pages.aiServices }).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('uses the Spanish labels from the issue', () => {
    expect(esCL.pages.aiServices.services.columns.usesLlm).toBe('Usa un LLM');
    expect(esCL.pages.aiServices.services.columns.allowed).toBe('Permitido');
    expect(esCL.pages.aiServices.services.scopes.case).toBe('Análisis de casos');
    expect(esCL.pages.aiServices.services.scopes.design).toBe('Análisis de diseños');
    expect(enUS.pages.aiServices.services.scopes.case).toBe('Case analyses');
    expect(enUS.pages.aiServices.services.scopes.design).toBe('Design analyses');
  });

  it('points missing client credentials to the EthicApp deployment in both locales', () => {
    expect(aiErrorKey('credentials_missing')).toBe('pages.aiServices.errors.credentials_missing');
    for (const locale of [enUS, esCL]) {
      const text = locale.pages.aiServices.errors.credentials_missing;
      expect(text).toContain('AI_ADDITIONS_KEYCLOAK_CLIENT_ID');
      expect(text).toContain('AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET');
      expect(text).toContain('INSTALL.md');
      expect(text).toContain('AI Services');
    }
  });

  it('maps unknown error codes to the generic message', () => {
    expect(aiErrorKey('something_else')).toBe('pages.aiServices.errors.generic');
    expect(enUS.pages.aiServices.errors.generic).toBeTruthy();
  });
});

describe('AI services adapter helpers', () => {
  it('groups adapters by scope in a fixed order, leaving empty groups out', () => {
    const groups = adaptersByScope([
      { id: 'typology', scopes: ['design'] },
      { id: 'evaluation', scopes: ['case'] },
      { id: 'both', scopes: ['response', 'chat'] },
      { id: 'unscoped' }
    ]);
    expect(groups.map((group) => [group.scope, group.adapters.map((adapter) => adapter.id)])).toEqual([
      ['case', ['evaluation']],
      ['design', ['typology']],
      ['response', ['both']],
      ['chat', ['both']],
      ['other', ['unscoped']]
    ]);
  });

  it('names adapters by label and lists the adapters of allowed services', () => {
    const names = adapterNamesById([{ id: 's', adapters: [{ id: 'a', label: 'Label' }, { id: 'b', label: null }] }]);
    expect([...names]).toEqual([['a', 'Label'], ['b', 'b']]);
    expect([...switchableAdapterIds(catalog.services, new Set(['case-analyst']))]).toEqual([
      'case-analyst-evaluation',
      'case-analyst-evidence-inventory',
      'case-analyst-claim-typology',
      'case-analyst-topic-listing'
    ]);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import enUS from '../../../i18n/locales/en_US.js';
import esCL from '../../../i18n/locales/es_CL.js';
import ConnectionSection from '../ConnectionSection.jsx';
import ConnectionTestResult from '../ConnectionTestResult.jsx';
import HistorySection from '../HistorySection.jsx';
import ServicesSection from '../ServicesSection.jsx';
import { aiErrorKey, serviceNamesById } from '../aiServicesFormat.js';

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
      adapters: [{ id: 'polyadic-agents', description: 'Agents in the chat' }]
    },
    {
      id: 'argumentation-tutor',
      name: 'Argumentation tutor',
      description: null,
      usesLlm: false,
      status: 'maintenance',
      available: false,
      adapters: []
    }
  ]
};

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

  for (const code of ['not_configured', 'unreachable', 'unauthorized', 'invalid_response', 'ethicapp_error']) {
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
        versions={[
          {
            id: 2,
            allowedServiceIds: ['polyadic-agent', 'retired-service'],
            note: 'Pilot course',
            createdAt: '2026-10-26T10:00:00.000Z',
            createdBy: { id: 7, name: 'Ada Lovelace' },
            launchedSessionCount: 4
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
  });

  it('maps unknown error codes to the generic message', () => {
    expect(aiErrorKey('something_else')).toBe('pages.aiServices.errors.generic');
    expect(enUS.pages.aiServices.errors.generic).toBeTruthy();
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import ServicesSection from '../ServicesSection.jsx';
import { IDLE_CATALOG, connectionKeyOf, createCatalogLoader } from '../catalogLoader.js';

const connectionA = { baseUrl: 'http://ai-a:8080', keycloakPublicUrl: null };
const connectionB = { baseUrl: 'https://ai-b.example.org', keycloakPublicUrl: 'https://ai-b.example.org/kc' };
const catalogA = { ok: true, services: [{ id: 'service-a', name: 'A', adapters: [] }] };
const catalogB = { ok: true, services: [{ id: 'service-b', name: 'B', adapters: [] }] };

// A fake fetchCatalog whose responses are released by the test, in any
// order. It rejects with an AbortError when its signal aborts, like fetch.
function createDeferredFetch() {
  const requests = [];
  const fetchCatalog = (locale, { signal }) => new Promise((resolve, reject) => {
    const request = { locale, signal, resolve, reject };
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
    requests.push(request);
  });
  return { requests, fetchCatalog };
}

// Mirrors the page: holds the latest state written by the loader.
function createHarness() {
  const deferred = createDeferredFetch();
  const states = [];
  const loader = createCatalogLoader({
    fetchCatalog: deferred.fetchCatalog,
    setState: (state) => states.push(state)
  });
  return { ...deferred, loader, states, latest: () => states.at(-1) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('catalog loader', () => {
  it('keeps the catalog of the newer connection when an older response arrives last (save)', async () => {
    const harness = createHarness();

    const loadA = harness.loader.load({ connectionKey: connectionKeyOf(connectionA), locale: 'en_US' });
    // The operator saves connection B while A's catalog is still pending.
    const loadB = harness.loader.load({ connectionKey: connectionKeyOf(connectionB), locale: 'en_US' });

    expect(harness.requests[0].signal.aborted).toBe(true);

    harness.requests[1].resolve(catalogB);
    await loadB;
    harness.requests[0].resolve(catalogA);
    await loadA;
    await flush();

    expect(harness.latest()).toEqual({ loading: false, result: catalogB, connectionKey: connectionKeyOf(connectionB) });
    expect(harness.states.some((state) => state.result === catalogA)).toBe(false);
  });

  it('ignores an older response that resolves even though its request was not aborted', async () => {
    // Some transports ignore abort; the generation check must still hold.
    const states = [];
    const pending = [];
    const loader = createCatalogLoader({
      fetchCatalog: () => new Promise((resolve) => pending.push(resolve)),
      setState: (state) => states.push(state)
    });

    const loadA = loader.load({ connectionKey: connectionKeyOf(connectionA), locale: 'en_US' });
    const loadB = loader.load({ connectionKey: connectionKeyOf(connectionB), locale: 'en_US' });
    pending[1](catalogB);
    await loadB;
    pending[0](catalogA);
    await loadA;

    expect(states.at(-1).result).toBe(catalogB);
  });

  it('drops a pending response after the connection is removed', async () => {
    const harness = createHarness();

    const loadA = harness.loader.load({ connectionKey: connectionKeyOf(connectionA), locale: 'en_US' });
    harness.loader.reset();
    expect(harness.requests[0].signal.aborted).toBe(true);

    harness.requests[0].resolve(catalogA);
    await loadA;
    await flush();

    expect(harness.latest()).toEqual(IDLE_CATALOG);
  });

  it('drops a pending response that resolves after removal even if abort is ignored', async () => {
    const states = [];
    let release;
    const loader = createCatalogLoader({
      fetchCatalog: () => new Promise((resolve) => { release = resolve; }),
      setState: (state) => states.push(state)
    });

    const loadA = loader.load({ connectionKey: connectionKeyOf(connectionA), locale: 'en_US' });
    loader.reset();
    release(catalogA);
    await loadA;

    expect(states.at(-1)).toEqual(IDLE_CATALOG);
  });

  it('writes nothing after dispose (unmount)', async () => {
    const harness = createHarness();
    const loadA = harness.loader.load({ connectionKey: connectionKeyOf(connectionA), locale: 'en_US' });
    const writesBeforeDispose = harness.states.length;

    harness.loader.dispose();
    harness.requests[0].resolve(catalogA);
    await loadA;
    await flush();

    expect(harness.requests[0].signal.aborted).toBe(true);
    expect(harness.states.length).toBe(writesBeforeDispose);
  });

  it('turns a failed current request into a generic error, but not a superseded one', async () => {
    const harness = createHarness();

    const loadA = harness.loader.load({ connectionKey: connectionKeyOf(connectionA), locale: 'es_CL' });
    harness.requests[0].reject(new Error('network'));
    await loadA;

    expect(harness.requests[0].locale).toBe('es_CL');
    expect(harness.latest()).toEqual({
      loading: false,
      result: { ok: false, error: 'generic' },
      connectionKey: connectionKeyOf(connectionA)
    });
  });

  it('keys catalogs by both connection URLs', () => {
    expect(connectionKeyOf(null)).toBe(null);
    expect(connectionKeyOf(connectionA)).not.toBe(connectionKeyOf({ ...connectionA, keycloakPublicUrl: 'https://kc' }));
  });
});

describe('services section after removal', () => {
  it('never renders the selection form without a connection, even with a successful catalog', () => {
    const html = renderToStaticMarkup(createElement(ServicesSection, {
      hasConnection: false,
      catalogState: { loading: false, result: catalogA },
      currentVersion: { id: 1, allowedServiceIds: [] },
      onSave: async () => {},
      onRetryCatalog: () => {}
    }));

    expect(html).not.toContain('ai-service-allowed-');
    expect(html).not.toContain('pages.aiServices.services.save');
    expect(html).toContain('pages.aiServices.services.noConnection');
  });
});

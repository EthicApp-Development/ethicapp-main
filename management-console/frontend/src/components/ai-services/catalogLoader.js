export const IDLE_CATALOG = Object.freeze({ loading: false, result: null, connectionKey: null });

// Identifies the connection a catalog belongs to. A catalog read for one
// connection must never be shown for another one.
export function connectionKeyOf(connection) {
  return connection ? `${connection.baseUrl}\n${connection.keycloakPublicUrl || ''}` : null;
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

// Loads the AI Additions catalog for one connection at a time. Every load or
// reset starts a new generation and aborts the previous request; a response
// is applied only while its generation is still current, so a slow response
// for an older connection (or for a connection removed meanwhile) is dropped.
//
// fetchCatalog(locale, { signal }) returns the catalog body;
// setState(state) receives { loading, result, connectionKey }.
export function createCatalogLoader({ fetchCatalog, setState }) {
  let generation = 0;
  let controller = null;

  function invalidate() {
    generation += 1;
    controller?.abort();
    controller = null;
    return generation;
  }

  async function load({ connectionKey, locale }) {
    const requestGeneration = invalidate();
    const requestController = new AbortController();
    controller = requestController;
    setState({ loading: true, result: null, connectionKey });

    let result;
    try {
      result = await fetchCatalog(locale, { signal: requestController.signal });
    } catch (error) {
      if (isAbortError(error) || requestGeneration !== generation) {
        return;
      }
      result = { ok: false, error: 'generic' };
    }

    if (requestGeneration !== generation) {
      return;
    }

    controller = null;
    setState({ loading: false, result, connectionKey });
  }

  // The connection was removed: forget any catalog and pending request.
  function reset() {
    invalidate();
    setState(IDLE_CATALOG);
  }

  // The page unmounted: drop pending requests without touching state.
  function dispose() {
    invalidate();
  }

  return { load, reset, dispose };
}

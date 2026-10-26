import dns from 'node:dns';

export function normalizeErrorCode(error) {
  return typeof error?.code === 'string' && error.code ? error.code : 'EUNKNOWN';
}

// IP literal targets need no name resolution.
export function skippedResult(host) {
  return { ok: true, skipped: true, addresses: [host], latencyMs: 0, error: null };
}

// getaddrinfo runs on the libuv threadpool and cannot be cancelled. Reusing
// the pending lookup for a host keeps repeated runs during a DNS outage from
// piling up blocked threadpool work.
export function createDedupedLookup(lookup = dns.promises.lookup) {
  const pendingLookups = new Map();

  return function lookupAddresses(host) {
    if (!pendingLookups.has(host)) {
      const pending = Promise.resolve()
        .then(() => lookup(host, { all: true }))
        .then((entries) => entries.map((entry) => entry.address))
        .finally(() => pendingLookups.delete(host));

      pendingLookups.set(host, pending);
    }

    return pendingLookups.get(host);
  };
}

import dns from 'node:dns';
import { readFile } from 'node:fs/promises';
import net from 'node:net';

const DNS_CHECK_TIMEOUT_MS = 3000;
const RESOLV_CONF_PATH = '/etc/resolv.conf';
const EXT_SERVERS_PATTERN = /^#\s*ExtServers:\s*\[([^\]]*)\]/m;
const HOST_SERVER_PATTERN = /^host\((.+)\)$/;

function createTimeoutError() {
  const error = new Error('DNS query timed out');
  error.code = 'ETIMEOUT';
  return error;
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(createTimeoutError());
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeErrorCode(error) {
  return typeof error?.code === 'string' && error.code ? error.code : 'EUNKNOWN';
}

// On user-defined networks (every docker compose project) the container only
// sees Docker's embedded DNS at 127.0.0.11. Docker records the upstream
// resolvers it forwards to in a comment such as
// "# ExtServers: [host(192.168.65.7) 100.100.100.100]"; those are the servers
// an operator needs to see to diagnose a broken host resolver.
export function parseUpstreamServers(resolvConf) {
  const match = EXT_SERVERS_PATTERN.exec(String(resolvConf ?? ''));

  if (!match) {
    return null;
  }

  return match[1]
    .split(/\s+/)
    .filter(Boolean)
    .map((server) => HOST_SERVER_PATTERN.exec(server)?.[1] ?? server);
}

function skippedResult(host) {
  return { ok: true, skipped: true, addresses: [host], latencyMs: 0, error: null };
}

export function createDnsHealthService({
  lookup = dns.promises.lookup,
  createResolver = (options) => new dns.promises.Resolver(options),
  getServers = () => dns.getServers(),
  readResolvConf = () => readFile(RESOLV_CONF_PATH, 'utf8'),
  now = Date.now,
  timeoutMs = DNS_CHECK_TIMEOUT_MS
} = {}) {
  // getaddrinfo runs on the libuv threadpool and cannot be cancelled. Reusing
  // the pending lookup for a host keeps repeated runs during a DNS outage from
  // piling up blocked threadpool work.
  const pendingLookups = new Map();

  function lookupAddresses(host) {
    if (!pendingLookups.has(host)) {
      const pending = Promise.resolve()
        .then(() => lookup(host, { all: true }))
        .then((entries) => entries.map((entry) => entry.address))
        .finally(() => pendingLookups.delete(host));

      pendingLookups.set(host, pending);
    }

    return pendingLookups.get(host);
  }

  async function resolveAddresses(resolver, host) {
    const settled = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
    const addresses = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));

    if (addresses.length > 0) {
      return addresses;
    }

    // A host with only A or only AAAA records answers ENODATA for the other
    // family, so prefer any more specific failure.
    const codes = settled.map((result) => result.reason?.code);
    const error = new Error('No addresses resolved');
    error.code = codes.find((code) => code && code !== 'ENODATA') ?? 'ENODATA';
    throw error;
  }

  async function measure(query, onTimeout) {
    const startedAt = now();

    try {
      const addresses = await withTimeout(query(), timeoutMs, onTimeout);
      return { ok: true, addresses, latencyMs: now() - startedAt, error: null };
    } catch (error) {
      return { ok: false, addresses: [], latencyMs: now() - startedAt, error: normalizeErrorCode(error) };
    }
  }

  async function checkTarget({ label, host, port }) {
    if (net.isIP(host)) {
      return { label, host, port, lookup: skippedResult(host), resolve: skippedResult(host) };
    }

    const resolver = createResolver({ timeout: timeoutMs, tries: 1 });
    const [lookupResult, resolveResult] = await Promise.all([
      measure(() => lookupAddresses(host)),
      measure(() => resolveAddresses(resolver, host), () => resolver.cancel())
    ]);

    return { label, host, port, lookup: lookupResult, resolve: resolveResult };
  }

  async function readUpstreamServers() {
    try {
      return parseUpstreamServers(await readResolvConf());
    } catch {
      return null;
    }
  }

  async function checkTargets(targets) {
    const [results, upstreamServers] = await Promise.all([
      Promise.all(targets.map(checkTarget)),
      readUpstreamServers()
    ]);

    return {
      checkedAt: new Date(now()).toISOString(),
      servers: getServers(),
      upstreamServers,
      targets: results
    };
  }

  return { checkTargets };
}

export { DNS_CHECK_TIMEOUT_MS };

import dns from 'node:dns';
import { readFile } from 'node:fs/promises';
import net from 'node:net';

import { withTimeout } from '../helpers/with-timeout.js';
import { createDedupedLookup, normalizeErrorCode, skippedResult } from './health-lookup.js';

const DNS_CHECK_TIMEOUT_MS = 3000;
const RESOLV_CONF_PATH = '/etc/resolv.conf';
const EXT_SERVERS_PATTERN = /^#\s*ExtServers:\s*\[([^\]]*)\]/m;
const HOST_SERVER_PATTERN = /^host\((.+)\)$/;

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

export function createDnsHealthService({
  lookup = dns.promises.lookup,
  createResolver = (options) => new dns.promises.Resolver(options),
  getServers = () => dns.getServers(),
  readResolvConf = () => readFile(RESOLV_CONF_PATH, 'utf8'),
  now = Date.now,
  timeoutMs = DNS_CHECK_TIMEOUT_MS
} = {}) {
  const lookupAddresses = createDedupedLookup(lookup);

  // Each family is bounded on its own so an A answer survives a hung AAAA
  // query (and vice versa). The resolver is cancelled only after both have
  // settled, so cancelling one family cannot rewrite the other's error code.
  async function resolveAddresses(resolver, host) {
    const settled = await Promise.allSettled([
      withTimeout(resolver.resolve4(host), timeoutMs),
      withTimeout(resolver.resolve6(host), timeoutMs)
    ]);

    if (settled.some((result) => result.reason?.code === 'ETIMEOUT')) {
      resolver.cancel();
    }

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

  async function measure(query) {
    const startedAt = now();

    try {
      const addresses = await query();
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
      measure(() => withTimeout(lookupAddresses(host), timeoutMs)),
      measure(() => resolveAddresses(resolver, host))
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

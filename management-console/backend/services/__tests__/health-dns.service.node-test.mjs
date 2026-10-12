import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createDnsHealthService, parseUpstreamServers } from '../health-dns.service.js';

function dnsError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function never() {
  return new Promise(() => {});
}

function createFakeResolverFactory(records) {
  const created = [];

  function createResolver(options) {
    const resolver = {
      options,
      cancelled: false,
      resolve4: (host) => records[host]?.resolve4?.() ?? Promise.reject(dnsError('ENOTFOUND')),
      resolve6: (host) => records[host]?.resolve6?.() ?? Promise.reject(dnsError('ENOTFOUND')),
      cancel() {
        resolver.cancelled = true;
      }
    };
    created.push(resolver);
    return resolver;
  }

  return { createResolver, created };
}

function createService({ lookup, records = {}, timeoutMs = 50, readResolvConf = async () => 'nameserver 100.100.100.100\n' } = {}) {
  const resolverFactory = createFakeResolverFactory(records);
  const service = createDnsHealthService({
    lookup,
    createResolver: resolverFactory.createResolver,
    getServers: () => ['100.100.100.100'],
    readResolvConf,
    now: () => Date.parse('2026-10-12T12:00:00.000Z'),
    timeoutMs
  });

  return { service, resolverFactory };
}

const smtpTarget = { label: 'smtp', host: 'smtp.gmail.com', port: 465 };

describe('management-console DNS health service', () => {
  it('reports lookup and resolve addresses for a resolvable host', async () => {
    const { service, resolverFactory } = createService({
      lookup: async (host, options) => {
        assert.equal(host, 'smtp.gmail.com');
        assert.deepEqual(options, { all: true });
        return [{ address: '142.250.0.108', family: 4 }];
      },
      records: {
        'smtp.gmail.com': {
          resolve4: async () => ['142.250.0.108'],
          resolve6: async () => ['2800:3f0:4003::6c']
        }
      }
    });

    const report = await service.checkTargets([smtpTarget]);

    assert.equal(report.checkedAt, '2026-10-12T12:00:00.000Z');
    assert.deepEqual(report.servers, ['100.100.100.100']);
    assert.equal(report.upstreamServers, null);
    assert.deepEqual(report.targets, [{
      label: 'smtp',
      host: 'smtp.gmail.com',
      port: 465,
      lookup: { ok: true, addresses: ['142.250.0.108'], latencyMs: 0, error: null },
      resolve: { ok: true, addresses: ['142.250.0.108', '2800:3f0:4003::6c'], latencyMs: 0, error: null }
    }]);
    assert.deepEqual(resolverFactory.created[0].options, { timeout: 50, tries: 1 });
  });

  it('reports NXDOMAIN from both resolution paths', async () => {
    const { service } = createService({
      lookup: async () => {
        throw dnsError('ENOTFOUND');
      }
    });

    const [target] = (await service.checkTargets([{ label: 'bad', host: 'missing.example.org', port: 443 }])).targets;

    assert.deepEqual(target.lookup, { ok: false, addresses: [], latencyMs: 0, error: 'ENOTFOUND' });
    assert.deepEqual(target.resolve, { ok: false, addresses: [], latencyMs: 0, error: 'ENOTFOUND' });
  });

  it('distinguishes a lookup success from a resolver failure', async () => {
    const { service } = createService({
      lookup: async () => [{ address: '10.0.0.5', family: 4 }],
      records: {
        'smtp.gmail.com': {
          resolve4: async () => {
            throw dnsError('ESERVFAIL');
          },
          resolve6: async () => {
            throw dnsError('ENODATA');
          }
        }
      }
    });

    const [target] = (await service.checkTargets([smtpTarget])).targets;

    assert.equal(target.lookup.ok, true);
    assert.deepEqual(target.lookup.addresses, ['10.0.0.5']);
    assert.equal(target.resolve.ok, false);
    assert.equal(target.resolve.error, 'ESERVFAIL');
  });

  it('accepts hosts with records for only one address family', async () => {
    const { service } = createService({
      lookup: async () => [{ address: '142.250.0.108', family: 4 }],
      records: {
        'smtp.gmail.com': {
          resolve4: async () => ['142.250.0.108'],
          resolve6: async () => {
            throw dnsError('ENODATA');
          }
        }
      }
    });

    const [target] = (await service.checkTargets([smtpTarget])).targets;

    assert.deepEqual(target.resolve, { ok: true, addresses: ['142.250.0.108'], latencyMs: 0, error: null });
  });

  it('reports ENODATA when neither family has records', async () => {
    const { service } = createService({
      lookup: async () => [],
      records: {
        'smtp.gmail.com': {
          resolve4: async () => {
            throw dnsError('ENODATA');
          },
          resolve6: async () => {
            throw dnsError('ENODATA');
          }
        }
      }
    });

    const [target] = (await service.checkTargets([smtpTarget])).targets;

    assert.equal(target.resolve.error, 'ENODATA');
  });

  it('times out hung queries and cancels the resolver', async () => {
    const { service, resolverFactory } = createService({
      lookup: never,
      records: { 'smtp.gmail.com': { resolve4: never, resolve6: never } },
      timeoutMs: 20
    });

    const startedAt = performance.now();
    const [target] = (await service.checkTargets([smtpTarget])).targets;
    const elapsedMs = performance.now() - startedAt;

    assert.equal(target.lookup.error, 'ETIMEOUT');
    assert.equal(target.resolve.error, 'ETIMEOUT');
    assert.equal(resolverFactory.created[0].cancelled, true);
    assert.ok(elapsedMs < 1000, `expected the check to finish near the timeout, took ${elapsedMs}ms`);
  });

  it('reuses a pending lookup for the same host across runs', async () => {
    let lookupCalls = 0;
    let finishLookup;
    const { service } = createService({
      lookup: () => {
        lookupCalls += 1;
        return new Promise((resolve) => {
          finishLookup = resolve;
        });
      },
      records: { 'smtp.gmail.com': { resolve4: async () => ['142.250.0.108'], resolve6: async () => [] } },
      timeoutMs: 20
    });

    await service.checkTargets([smtpTarget]);
    await service.checkTargets([smtpTarget]);
    assert.equal(lookupCalls, 1);

    finishLookup([{ address: '142.250.0.108', family: 4 }]);
    await new Promise((resolve) => setImmediate(resolve));

    const [target] = (await service.checkTargets([smtpTarget])).targets;
    assert.equal(lookupCalls, 2);
    assert.equal(target.lookup.ok, false);
  });

  it('skips DNS for IP literal targets', async () => {
    const { service, resolverFactory } = createService({
      lookup: async () => {
        throw new Error('lookup must not be called');
      }
    });

    const [target] = (await service.checkTargets([{ label: 'relay', host: '10.0.0.5', port: 25 }])).targets;

    assert.deepEqual(target.lookup, { ok: true, skipped: true, addresses: ['10.0.0.5'], latencyMs: 0, error: null });
    assert.deepEqual(target.resolve, target.lookup);
    assert.equal(resolverFactory.created.length, 0);
  });

  it('normalizes errors without a code', async () => {
    const { service } = createService({
      lookup: async () => {
        throw new Error('unexpected');
      }
    });

    const [target] = (await service.checkTargets([smtpTarget])).targets;

    assert.equal(target.lookup.error, 'EUNKNOWN');
  });

  it('returns an empty target list when nothing is configured', async () => {
    const { service } = createService({ lookup: never });

    assert.deepEqual(await service.checkTargets([]), {
      checkedAt: '2026-10-12T12:00:00.000Z',
      servers: ['100.100.100.100'],
      upstreamServers: null,
      targets: []
    });
  });

  it('reports the upstream resolvers behind Docker embedded DNS', async () => {
    const { service } = createService({
      lookup: never,
      readResolvConf: async () => [
        '# Generated by Docker Engine.',
        'nameserver 127.0.0.11',
        'options ndots:0',
        '',
        '# Based on host file: \'/etc/resolv.conf\' (internal resolver)',
        '# ExtServers: [host(100.100.100.100)]',
        '# Overrides: []'
      ].join('\n')
    });

    assert.deepEqual((await service.checkTargets([])).upstreamServers, ['100.100.100.100']);
  });

  it('reports null upstream resolvers when resolv.conf cannot be read', async () => {
    const { service } = createService({
      lookup: never,
      readResolvConf: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
    });

    assert.equal((await service.checkTargets([])).upstreamServers, null);
  });
});

describe('parseUpstreamServers', () => {
  it('parses host-namespace and plain upstream servers', () => {
    assert.deepEqual(
      parseUpstreamServers('nameserver 127.0.0.11\n# ExtServers: [host(192.168.65.7) 8.8.8.8 2001:4860:4860::8888]\n'),
      ['192.168.65.7', '8.8.8.8', '2001:4860:4860::8888']
    );
  });

  it('returns an empty list for an empty ExtServers comment', () => {
    assert.deepEqual(parseUpstreamServers('# ExtServers: []'), []);
  });

  it('returns null when the file has no ExtServers comment', () => {
    assert.equal(parseUpstreamServers('nameserver 192.168.1.1\n'), null);
    assert.equal(parseUpstreamServers(undefined), null);
  });
});

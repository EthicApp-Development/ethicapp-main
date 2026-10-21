import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { createConnectivityHealthService } from '../health-connectivity.service.js';

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

class FakeSocket extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
  }

  destroy() {
    this.destroyed = true;
  }
}

// Behaviours: 'connect' | 'hang' | an error code string.
function createFakeNetwork({ tcp = {}, tls = {}, certificate = null, protocol = 'TLSv1.3' } = {}) {
  const tcpSockets = [];
  const tlsSockets = [];

  function createConnection(options) {
    const socket = new FakeSocket(options);
    tcpSockets.push(socket);
    const behaviour = tcp[options.host] ?? 'connect';

    setImmediate(() => {
      if (behaviour === 'connect') {
        socket.emit('connect');
      } else if (behaviour !== 'hang') {
        socket.emit('error', codedError(behaviour));
      }
    });

    return socket;
  }

  function tlsConnect(options) {
    const socket = new FakeSocket(options);
    socket.getProtocol = () => protocol;
    socket.getPeerCertificate = () => certificate ?? {};
    tlsSockets.push(socket);
    const behaviour = tls[options.host] ?? 'secureConnect';

    setImmediate(() => {
      if (behaviour === 'secureConnect') {
        socket.emit('secureConnect');
      } else if (behaviour !== 'hang') {
        socket.emit('error', codedError(behaviour));
      }
    });

    return socket;
  }

  return { createConnection, tlsConnect, tcpSockets, tlsSockets };
}

// Generous defaults: the fake network answers on the next tick, so these only
// bound tests that do not exercise timing, and must not trip on a slow host
// (image builds run this suite under amd64 emulation, files in parallel).
// Tests about timeouts and deadlines pass their own small values.
function createService(network, {
  lookup,
  stageTimeoutMs = 2000,
  deadlineMs = 5000,
  attemptDelayMs = 1000,
  now = () => Date.parse('2026-10-12T12:00:00.000Z')
} = {}) {
  return createConnectivityHealthService({
    lookup: lookup ?? (async () => [{ address: '192.0.2.10', family: 4 }]),
    createConnection: network.createConnection,
    tlsConnect: network.tlsConnect,
    now,
    stageTimeoutMs,
    deadlineMs,
    attemptDelayMs
  });
}

const openaiTarget = { label: 'openai', host: 'api.openai.com', port: 443 };

describe('management-console connectivity health service', () => {
  it('reports a reachable TLS target with protocol and certificate details', async () => {
    const network = createFakeNetwork({
      certificate: {
        subject: { CN: 'api.openai.com' },
        issuer: { O: 'Google Trust Services', CN: 'WE1' },
        valid_to: 'Dec 31 23:59:59 2026 GMT'
      }
    });

    const report = await createService(network).checkTargets([openaiTarget]);

    assert.equal(report.checkedAt, '2026-10-12T12:00:00.000Z');
    assert.equal(report.deadlineExceeded, false);
    assert.deepEqual(report.targets, [{
      label: 'openai',
      host: 'api.openai.com',
      port: 443,
      reachable: true,
      failedStage: null,
      error: null,
      stages: {
        dns: { ok: true, addresses: ['192.0.2.10'], latencyMs: 0, error: null },
        tcp: {
          ok: true,
          address: '192.0.2.10',
          latencyMs: 0,
          error: null,
          attempts: [{ address: '192.0.2.10', outcome: 'connected', error: null }]
        },
        tls: {
          ok: true,
          latencyMs: 0,
          error: null,
          protocol: 'TLSv1.3',
          certificate: {
            subject: 'api.openai.com',
            issuer: 'Google Trust Services',
            validTo: '2026-12-31T23:59:59.000Z'
          }
        }
      }
    }]);
  });

  it('connects only to the resolved address and the allowlisted port, verifying the certificate', async () => {
    const network = createFakeNetwork();

    await createService(network).checkTargets([openaiTarget]);

    assert.deepEqual(network.tcpSockets.map((socket) => socket.options), [{ host: '192.0.2.10', port: 443 }]);
    assert.equal(network.tlsSockets[0].options.socket, network.tcpSockets[0]);
    assert.equal(network.tlsSockets[0].options.servername, 'api.openai.com');
    assert.equal(network.tlsSockets[0].options.rejectUnauthorized, true);
  });

  it('destroys every socket after a successful check', async () => {
    const network = createFakeNetwork();

    await createService(network).checkTargets([openaiTarget]);

    assert.ok(network.tcpSockets.every((socket) => socket.destroyed));
    assert.ok(network.tlsSockets.every((socket) => socket.destroyed));
  });

  it('stops at the TCP stage for ports without implicit TLS', async () => {
    const network = createFakeNetwork();

    const [target] = (await createService(network).checkTargets([
      { label: 'smtp-starttls', host: 'smtp.example.org', port: 587 }
    ])).targets;

    assert.equal(target.reachable, true);
    assert.equal(target.stages.tls, null);
    assert.equal(network.tlsSockets.length, 0);
    assert.ok(network.tcpSockets[0].destroyed);
  });

  it('reports a DNS failure without opening sockets', async () => {
    const network = createFakeNetwork();
    const service = createService(network, {
      lookup: async () => {
        throw codedError('ENOTFOUND');
      }
    });

    const [target] = (await service.checkTargets([openaiTarget])).targets;

    assert.equal(target.reachable, false);
    assert.equal(target.failedStage, 'dns');
    assert.equal(target.error, 'ENOTFOUND');
    assert.equal(target.stages.tcp, null);
    assert.equal(network.tcpSockets.length, 0);
  });

  it('reports a DNS timeout when the lookup hangs', async () => {
    const network = createFakeNetwork();
    const service = createService(network, { lookup: () => new Promise(() => {}), stageTimeoutMs: 20 });

    const [target] = (await service.checkTargets([openaiTarget])).targets;

    assert.equal(target.failedStage, 'dns');
    assert.equal(target.error, 'ETIMEOUT');
  });

  it('reports a refused TCP connection and destroys the socket', async () => {
    const network = createFakeNetwork({ tcp: { '192.0.2.10': 'ECONNREFUSED' } });

    const [target] = (await createService(network).checkTargets([openaiTarget])).targets;

    assert.equal(target.failedStage, 'tcp');
    assert.equal(target.error, 'ECONNREFUSED');
    assert.equal(target.stages.tls, null);
    assert.equal(network.tlsSockets.length, 0);
    assert.ok(network.tcpSockets[0].destroyed);
  });

  it('reports a TCP timeout and destroys the socket', async () => {
    const network = createFakeNetwork({ tcp: { '192.0.2.10': 'hang' } });

    const [target] = (await createService(network, { stageTimeoutMs: 20 }).checkTargets([openaiTarget])).targets;

    assert.equal(target.failedStage, 'tcp');
    assert.equal(target.error, 'ETIMEOUT');
    assert.ok(network.tcpSockets[0].destroyed);
  });

  it('tries IPv4 first and falls back to the next address', async () => {
    const network = createFakeNetwork({ tcp: { '192.0.2.10': 'ENETUNREACH' } });
    const service = createService(network, {
      lookup: async () => [
        { address: '2001:db8::10', family: 6 },
        { address: '192.0.2.10', family: 4 }
      ]
    });

    const [target] = (await service.checkTargets([openaiTarget])).targets;

    assert.equal(target.reachable, true);
    assert.equal(target.stages.tcp.address, '2001:db8::10');
    assert.deepEqual(target.stages.tcp.attempts, [
      { address: '192.0.2.10', outcome: 'failed', error: 'ENETUNREACH' },
      { address: '2001:db8::10', outcome: 'connected', error: null }
    ]);
    assert.ok(network.tcpSockets.every((socket) => socket.destroyed));
  });

  it('tries the next address while the first one hangs (P2 regression)', async () => {
    const network = createFakeNetwork({ tcp: { '192.0.2.1': 'hang', '192.0.2.2': 'connect' } });
    const service = createService(network, {
      lookup: async () => [
        { address: '192.0.2.1', family: 4 },
        { address: '192.0.2.2', family: 4 }
      ],
      stageTimeoutMs: 100,
      attemptDelayMs: 10,
      // A real clock: a fixed one would never use up the stage budget.
      now: Date.now
    });

    const [target] = (await service.checkTargets([{ label: 'relay', host: 'relay.example.org', port: 25 }])).targets;

    assert.equal(target.reachable, true);
    assert.equal(target.stages.tcp.address, '192.0.2.2');
    assert.deepEqual(target.stages.tcp.attempts, [
      { address: '192.0.2.1', outcome: 'abandoned', error: null },
      { address: '192.0.2.2', outcome: 'connected', error: null }
    ]);
    assert.deepEqual(network.tcpSockets.map((socket) => socket.options.host), ['192.0.2.1', '192.0.2.2']);
    assert.ok(network.tcpSockets.every((socket) => socket.destroyed));
  });

  it('reports EDEADLINE after an earlier TCP attempt failed (P3 regression)', async () => {
    const network = createFakeNetwork({ tcp: { '192.0.2.1': 'ECONNREFUSED', '192.0.2.2': 'hang' } });
    const service = createService(network, {
      lookup: async () => [
        { address: '192.0.2.1', family: 4 },
        { address: '192.0.2.2', family: 4 }
      ],
      stageTimeoutMs: 100,
      deadlineMs: 20
    });

    const report = await service.checkTargets([{ label: 'relay', host: 'relay.example.org', port: 25 }]);

    assert.equal(report.deadlineExceeded, true);
    assert.equal(report.targets[0].failedStage, 'tcp');
    assert.equal(report.targets[0].error, 'EDEADLINE');
    assert.ok(network.tcpSockets.every((socket) => socket.destroyed));
  });

  it('bounds every attempt by the stage timeout when all addresses hang', async () => {
    const network = createFakeNetwork({ tcp: { '192.0.2.1': 'hang', '192.0.2.2': 'hang' } });
    const service = createService(network, {
      lookup: async () => [
        { address: '192.0.2.1', family: 4 },
        { address: '192.0.2.2', family: 4 }
      ],
      stageTimeoutMs: 40,
      attemptDelayMs: 10
    });

    const startedAt = performance.now();
    const [target] = (await service.checkTargets([{ label: 'relay', host: 'relay.example.org', port: 25 }])).targets;
    const elapsedMs = performance.now() - startedAt;

    assert.equal(target.error, 'ETIMEOUT');
    assert.deepEqual(target.stages.tcp.attempts.map((attempt) => [attempt.outcome, attempt.error]), [
      ['failed', 'ETIMEOUT'],
      ['failed', 'ETIMEOUT']
    ]);
    assert.ok(network.tcpSockets.every((socket) => socket.destroyed));
    assert.ok(elapsedMs < 500, `expected one stage budget for all attempts, took ${elapsedMs}ms`);
  });

  it('waits for the attempt delay before racing the next address', async () => {
    const network = createFakeNetwork({ tcp: { '192.0.2.1': 'connect' } });
    const service = createService(network, {
      lookup: async () => [
        { address: '192.0.2.1', family: 4 },
        { address: '192.0.2.2', family: 4 }
      ]
    });

    const [target] = (await service.checkTargets([{ label: 'relay', host: 'relay.example.org', port: 25 }])).targets;

    assert.equal(target.stages.tcp.address, '192.0.2.1');
    assert.deepEqual(network.tcpSockets.map((socket) => socket.options.host), ['192.0.2.1']);
  });

  it('reports the first attempt error when every address fails', async () => {
    const network = createFakeNetwork({ tcp: { '192.0.2.10': 'ECONNREFUSED', '2001:db8::10': 'ENETUNREACH' } });
    const service = createService(network, {
      lookup: async () => [
        { address: '2001:db8::10', family: 6 },
        { address: '192.0.2.10', family: 4 }
      ]
    });

    const [target] = (await service.checkTargets([openaiTarget])).targets;

    assert.equal(target.failedStage, 'tcp');
    assert.equal(target.error, 'ECONNREFUSED');
    assert.equal(target.stages.tcp.attempts.length, 2);
  });

  it('reports a TLS certificate error and destroys both sockets', async () => {
    const network = createFakeNetwork({ tls: { 'api.openai.com': 'CERT_HAS_EXPIRED' } });

    const [target] = (await createService(network).checkTargets([openaiTarget])).targets;

    assert.equal(target.reachable, false);
    assert.equal(target.failedStage, 'tls');
    assert.equal(target.error, 'CERT_HAS_EXPIRED');
    assert.equal(target.stages.tcp.ok, true);
    assert.deepEqual(target.stages.tls, {
      ok: false,
      latencyMs: 0,
      error: 'CERT_HAS_EXPIRED',
      protocol: null,
      certificate: null
    });
    assert.ok(network.tcpSockets[0].destroyed);
    assert.ok(network.tlsSockets[0].destroyed);
  });

  it('reports a TLS handshake timeout', async () => {
    const network = createFakeNetwork({ tls: { 'api.openai.com': 'hang' } });

    const [target] = (await createService(network, { stageTimeoutMs: 20 }).checkTargets([openaiTarget])).targets;

    assert.equal(target.failedStage, 'tls');
    assert.equal(target.error, 'ETIMEOUT');
    assert.ok(network.tlsSockets[0].destroyed);
  });

  it('skips DNS and SNI for IP literal targets', async () => {
    const network = createFakeNetwork();
    const service = createService(network, {
      lookup: async () => {
        throw new Error('lookup must not be called');
      }
    });

    const [target] = (await service.checkTargets([{ label: 'ip', host: '192.0.2.20', port: 443 }])).targets;

    assert.equal(target.reachable, true);
    assert.equal(target.stages.dns.skipped, true);
    assert.equal(network.tcpSockets[0].options.host, '192.0.2.20');
    assert.equal('servername' in network.tlsSockets[0].options, false);
  });

  it('stops every target at the overall deadline and destroys open sockets', async () => {
    const network = createFakeNetwork({ tcp: { '192.0.2.10': 'hang' } });
    const service = createService(network, { stageTimeoutMs: 5000, deadlineMs: 20 });

    const startedAt = performance.now();
    const report = await service.checkTargets([openaiTarget]);
    const elapsedMs = performance.now() - startedAt;

    assert.equal(report.deadlineExceeded, true);
    assert.equal(report.targets[0].failedStage, 'tcp');
    assert.equal(report.targets[0].error, 'EDEADLINE');
    assert.ok(network.tcpSockets[0].destroyed);
    assert.ok(elapsedMs < 1000, `expected the deadline to bound the check, took ${elapsedMs}ms`);
  });

  it('checks targets concurrently and reports each one', async () => {
    const network = createFakeNetwork({ tcp: { '192.0.2.11': 'ECONNREFUSED' } });
    const service = createService(network, {
      lookup: async (host) => [{ address: host === 'ok.example.org' ? '192.0.2.10' : '192.0.2.11', family: 4 }]
    });

    const report = await service.checkTargets([
      { label: 'ok', host: 'ok.example.org', port: 25 },
      { label: 'closed', host: 'closed.example.org', port: 25 }
    ]);

    assert.deepEqual(report.targets.map((target) => [target.label, target.reachable, target.error]), [
      ['ok', true, null],
      ['closed', false, 'ECONNREFUSED']
    ]);
  });

  it('returns an empty report when nothing is configured', async () => {
    const report = await createService(createFakeNetwork()).checkTargets([]);

    assert.deepEqual(report, {
      checkedAt: '2026-10-12T12:00:00.000Z',
      deadlineExceeded: false,
      targets: []
    });
  });
});

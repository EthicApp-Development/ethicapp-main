import net from 'node:net';
import tls from 'node:tls';

import { createDeadlineError, createTimeoutError, withTimeout } from '../helpers/with-timeout.js';
import { createDedupedLookup, normalizeErrorCode, skippedResult } from './health-lookup.js';

const STAGE_TIMEOUT_MS = 3000;
const CONNECTIVITY_DEADLINE_MS = 10000;
// Delay before racing the next resolved address while earlier attempts are
// still pending, as in Happy Eyeballs (RFC 8305) and Node's
// autoSelectFamilyAttemptTimeout default.
const CONNECTION_ATTEMPT_DELAY_MS = 250;

// Ports whose protocol starts with a TLS handshake. STARTTLS ports such as
// 587 or 25 are checked up to the TCP stage only.
const IMPLICIT_TLS_PORTS = new Set([443, 465, 993, 995, 8443]);

function orderIpv4First(addresses) {
  return [...addresses].sort((left, right) => net.isIPv6(left) - net.isIPv6(right));
}

function summarizeCertificate(certificate) {
  if (!certificate || Object.keys(certificate).length === 0) {
    return null;
  }

  const validTo = certificate.valid_to ? new Date(certificate.valid_to) : null;

  return {
    subject: certificate.subject?.CN ?? null,
    issuer: certificate.issuer?.O ?? certificate.issuer?.CN ?? null,
    validTo: validTo && !Number.isNaN(validTo.getTime()) ? validTo.toISOString() : null
  };
}

function abortReason(signal) {
  return typeof signal.reason?.code === 'string' ? signal.reason : createDeadlineError();
}

// Resolves once `socket` emits `readyEvent`; rejects on socket error, timeout
// or abort (with the signal's coded reason). The socket is destroyed on every
// failure path, and a permanent error listener stays attached so late errors
// on a socket that is still open cannot crash the process.
function awaitSocket(socket, readyEvent, { timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    function onAbort() {
      finish(abortReason(signal));
    }

    function finish(error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);

      if (error) {
        socket.destroy();
        reject(error);
      } else {
        resolve(socket);
      }
    }

    socket.on('error', finish);
    socket.once(readyEvent, () => finish());
    timer = setTimeout(() => finish(createTimeoutError()), timeoutMs);

    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function createConnectivityHealthService({
  lookup,
  createConnection = net.createConnection,
  tlsConnect = tls.connect,
  now = Date.now,
  stageTimeoutMs = STAGE_TIMEOUT_MS,
  deadlineMs = CONNECTIVITY_DEADLINE_MS,
  attemptDelayMs = CONNECTION_ATTEMPT_DELAY_MS
} = {}) {
  const lookupAddresses = createDedupedLookup(lookup);

  async function runDnsStage(host, signal) {
    if (net.isIP(host)) {
      return skippedResult(host);
    }

    const startedAt = now();

    try {
      const addresses = await withTimeout(lookupAddresses(host), stageTimeoutMs, { signal });

      if (addresses.length === 0) {
        return { ok: false, addresses: [], latencyMs: now() - startedAt, error: 'ENODATA' };
      }

      return { ok: true, addresses, latencyMs: now() - startedAt, error: null };
    } catch (error) {
      return { ok: false, addresses: [], latencyMs: now() - startedAt, error: normalizeErrorCode(error) };
    }
  }

  // Containers often have no IPv6 route, so IPv4 addresses go first. Attempts
  // are staggered: the next address starts when the previous one fails or has
  // not connected after `attemptDelayMs`, earlier attempts keep running, and
  // the first connection wins. One stage timer bounds every attempt, so a
  // silently dropping address cannot use up the budget for the others.
  function runTcpStage(addresses, port, signal) {
    const startedAt = now();
    const queue = orderIpv4First(addresses);
    const attempts = [];
    const active = new Set();
    const stageController = new AbortController();
    const stageSignal = signal ? AbortSignal.any([signal, stageController.signal]) : stageController.signal;

    return new Promise((resolve) => {
      let finished = false;
      let nextAttemptTimer = null;
      const stageTimer = setTimeout(() => stageController.abort(createTimeoutError()), stageTimeoutMs);

      function finish(socket, address) {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(stageTimer);
        clearTimeout(nextAttemptTimer);

        if (socket) {
          resolve({
            socket,
            result: { ok: true, address, latencyMs: now() - startedAt, error: null, attempts }
          });
          return;
        }

        // The overall deadline outranks earlier per-address failures.
        const errors = attempts.map((attempt) => attempt.error).filter(Boolean);
        const error = errors.includes('EDEADLINE') ? 'EDEADLINE' : errors[0] ?? 'ETIMEOUT';

        resolve({
          socket: null,
          result: { ok: false, address: null, latencyMs: now() - startedAt, error, attempts }
        });
      }

      function startNextAttempt() {
        clearTimeout(nextAttemptTimer);

        if (finished || stageSignal.aborted || queue.length === 0) {
          return;
        }

        const address = queue.shift();
        const attempt = { address, outcome: 'pending', error: null };
        const attemptController = new AbortController();
        const entry = { attempt, attemptController };
        const socket = createConnection({ host: address, port });

        attempts.push(attempt);
        active.add(entry);

        awaitSocket(socket, 'connect', {
          timeoutMs: stageTimeoutMs,
          signal: AbortSignal.any([stageSignal, attemptController.signal])
        }).then(() => {
          active.delete(entry);

          if (finished) {
            attempt.outcome = 'abandoned';
            socket.destroy();
            return;
          }

          attempt.outcome = 'connected';

          for (const other of active) {
            other.attempt.outcome = 'abandoned';
            other.attemptController.abort();
          }

          finish(socket, address);
        }, (error) => {
          active.delete(entry);

          if (attempt.outcome === 'abandoned') {
            return;
          }

          attempt.outcome = 'failed';
          attempt.error = normalizeErrorCode(error);

          if (queue.length > 0 && !stageSignal.aborted) {
            startNextAttempt();
          } else if (active.size === 0) {
            finish(null);
          }
        });

        if (queue.length > 0) {
          nextAttemptTimer = setTimeout(startNextAttempt, attemptDelayMs);
        }
      }

      if (queue.length === 0) {
        finish(null);
        return;
      }

      startNextAttempt();
    });
  }

  async function runTlsStage(tcpSocket, host, signal) {
    const startedAt = now();
    const options = { socket: tcpSocket, host, rejectUnauthorized: true };

    if (!net.isIP(host)) {
      options.servername = host;
    }

    const tlsSocket = tlsConnect(options);

    try {
      await awaitSocket(tlsSocket, 'secureConnect', { timeoutMs: stageTimeoutMs, signal });

      return {
        socket: tlsSocket,
        result: {
          ok: true,
          latencyMs: now() - startedAt,
          error: null,
          protocol: tlsSocket.getProtocol?.() ?? null,
          certificate: summarizeCertificate(tlsSocket.getPeerCertificate?.())
        }
      };
    } catch (error) {
      return {
        socket: tlsSocket,
        result: {
          ok: false,
          latencyMs: now() - startedAt,
          error: normalizeErrorCode(error),
          protocol: null,
          certificate: null
        }
      };
    }
  }

  async function checkTarget({ label, host, port }, signal) {
    const usesTls = IMPLICIT_TLS_PORTS.has(port);
    const report = (failedStage, stages) => ({
      label,
      host,
      port,
      reachable: failedStage === null,
      failedStage,
      error: failedStage ? stages[failedStage].error : null,
      stages: { dns: null, tcp: null, tls: null, ...stages }
    });

    const dns = await runDnsStage(host, signal);

    if (!dns.ok) {
      return report('dns', { dns });
    }

    const { socket: tcpSocket, result: tcp } = await runTcpStage(dns.addresses, port, signal);

    if (!tcp.ok) {
      return report('tcp', { dns, tcp });
    }

    let tlsSocket = null;

    try {
      if (!usesTls) {
        return report(null, { dns, tcp });
      }

      const tlsStage = await runTlsStage(tcpSocket, host, signal);
      tlsSocket = tlsStage.socket;

      return report(tlsStage.result.ok ? null : 'tls', { dns, tcp, tls: tlsStage.result });
    } finally {
      tlsSocket?.destroy();
      tcpSocket.destroy();
    }
  }

  async function checkTargets(targets) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(createDeadlineError()), deadlineMs);

    try {
      const results = await Promise.all(targets.map((target) => checkTarget(target, controller.signal)));

      return {
        checkedAt: new Date(now()).toISOString(),
        deadlineExceeded: controller.signal.aborted,
        targets: results
      };
    } finally {
      clearTimeout(deadline);
    }
  }

  return { checkTargets };
}

export { CONNECTION_ATTEMPT_DELAY_MS, CONNECTIVITY_DEADLINE_MS, IMPLICIT_TLS_PORTS, STAGE_TIMEOUT_MS };

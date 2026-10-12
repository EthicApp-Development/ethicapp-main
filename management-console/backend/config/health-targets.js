import net from 'node:net';

const MAX_HEALTH_CHECK_TARGETS = 20;

const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HOSTNAME_LABEL_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const BRACKETED_ADDRESS_PATTERN = /^\[([^\]]+)\]:([^:]*)$/;
const PORT_PATTERN = /^\d{1,5}$/;
const URL_SYNTAX_PATTERN = /[/@?#]/;
const INVALID_HOST_MESSAGE = 'host must be a hostname or IP address without scheme, credentials or path';

let cachedTargets = null;

function isValidHostname(value) {
  if (value.length === 0 || value.length > 253) {
    return false;
  }

  return value.split('.').every((part) => HOSTNAME_LABEL_PATTERN.test(part));
}

function parsePort(value) {
  if (!PORT_PATTERN.test(value)) {
    return null;
  }

  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

function splitAddress(address) {
  const bracketed = BRACKETED_ADDRESS_PATTERN.exec(address);

  if (bracketed) {
    return net.isIPv6(bracketed[1])
      ? { host: bracketed[1], portText: bracketed[2] }
      : { error: 'bracketed host must be an IPv6 address' };
  }

  const separatorIndex = address.lastIndexOf(':');

  if (separatorIndex === -1) {
    return { error: 'expected host:port' };
  }

  const host = address.slice(0, separatorIndex);

  if (host.includes(':')) {
    return { error: 'IPv6 addresses must be written as [address]:port' };
  }

  return { host, portText: address.slice(separatorIndex + 1) };
}

function parseEntry(entry) {
  const separatorIndex = entry.indexOf('=');

  if (separatorIndex === -1) {
    return { error: 'expected label=host:port' };
  }

  const label = entry.slice(0, separatorIndex).trim();
  const address = entry.slice(separatorIndex + 1).trim();

  if (!LABEL_PATTERN.test(label)) {
    return { error: 'label must use lowercase letters, digits and hyphens (max 40 characters)' };
  }

  if (URL_SYNTAX_PATTERN.test(address)) {
    return { error: INVALID_HOST_MESSAGE };
  }

  const { host, portText, error } = splitAddress(address);

  if (error) {
    return { error };
  }

  if (!net.isIP(host) && !isValidHostname(host)) {
    return { error: INVALID_HOST_MESSAGE };
  }

  const port = parsePort(portText);

  if (port === null) {
    return { error: 'port must be an integer between 1 and 65535' };
  }

  return { target: Object.freeze({ label, host, port }) };
}

function parseHealthCheckTargets(rawValue, { warn = console.warn } = {}) {
  const entries = String(rawValue ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const targets = [];
  const labels = new Set();

  entries.forEach((entry, index) => {
    const { target, error } = parseEntry(entry);

    if (error) {
      warn(`MNG_HEALTH_CHECK_TARGETS: ignoring entry ${index + 1} ("${entry}"): ${error}.`);
      return;
    }

    if (labels.has(target.label)) {
      warn(`MNG_HEALTH_CHECK_TARGETS: ignoring entry ${index + 1}: duplicate label "${target.label}".`);
      return;
    }

    if (targets.length >= MAX_HEALTH_CHECK_TARGETS) {
      warn(
        `MNG_HEALTH_CHECK_TARGETS: ignoring entry ${index + 1}: `
        + `at most ${MAX_HEALTH_CHECK_TARGETS} targets are allowed.`
      );
      return;
    }

    labels.add(target.label);
    targets.push(target);
  });

  return Object.freeze(targets);
}

// Parsed on first use and reused afterwards. server.js calls this right after
// loading .env so configuration warnings are logged at startup.
function getHealthCheckTargets() {
  cachedTargets ??= parseHealthCheckTargets(process.env.MNG_HEALTH_CHECK_TARGETS);
  return cachedTargets;
}

export {
  MAX_HEALTH_CHECK_TARGETS,
  getHealthCheckTargets,
  parseHealthCheckTargets
};

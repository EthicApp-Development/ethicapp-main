import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_HEALTH_CHECK_TARGETS,
  getHealthCheckTargets,
  parseHealthCheckTargets
} from '../health-targets.js';

function parseWithWarnings(rawValue) {
  const warnings = [];
  const targets = parseHealthCheckTargets(rawValue, { warn: (message) => warnings.push(message) });
  return { targets, warnings };
}

describe('management-console health check targets config', () => {
  it('returns an empty list when the variable is missing or blank', () => {
    for (const rawValue of [undefined, null, '', '  ', ' , ,']) {
      const { targets, warnings } = parseWithWarnings(rawValue);

      assert.deepEqual(targets, []);
      assert.deepEqual(warnings, []);
    }
  });

  it('parses label=host:port entries in order', () => {
    const { targets, warnings } = parseWithWarnings(
      ' smtp=smtp.gmail.com:465 , openai=api.openai.com:443,local-relay=10.0.0.5:25,v6=[2001:db8::1]:443'
    );

    assert.deepEqual(warnings, []);
    assert.deepEqual(targets, [
      { label: 'smtp', host: 'smtp.gmail.com', port: 465 },
      { label: 'openai', host: 'api.openai.com', port: 443 },
      { label: 'local-relay', host: '10.0.0.5', port: 25 },
      { label: 'v6', host: '2001:db8::1', port: 443 }
    ]);
  });

  it('freezes the list and every target', () => {
    const { targets } = parseWithWarnings('smtp=smtp.gmail.com:465');

    assert.ok(Object.isFrozen(targets));
    assert.ok(Object.isFrozen(targets[0]));
    assert.throws(() => targets.push({ label: 'x', host: 'x', port: 1 }), TypeError);
  });

  const rejectedEntries = [
    ['missing label separator', 'smtp.gmail.com:465'],
    ['empty label', '=smtp.gmail.com:465'],
    ['uppercase label', 'SMTP=smtp.gmail.com:465'],
    ['label with spaces', 'my smtp=smtp.gmail.com:465'],
    ['missing port', 'smtp=smtp.gmail.com'],
    ['empty port', 'smtp=smtp.gmail.com:'],
    ['non-numeric port', 'smtp=smtp.gmail.com:smtp'],
    ['port zero', 'smtp=smtp.gmail.com:0'],
    ['port out of range', 'smtp=smtp.gmail.com:65536'],
    ['URL scheme', 'openai=https://api.openai.com:443'],
    ['path', 'openai=api.openai.com/v1:443'],
    ['credentials', 'smtp=user:pass@smtp.gmail.com:465'],
    ['query string', 'openai=api.openai.com?x=1:443'],
    ['unbracketed IPv6', 'v6=2001:db8::1:443'],
    ['bracketed non-IPv6 host', 'v6=[api.openai.com]:443'],
    ['invalid hostname label', 'bad=-api.openai.com:443'],
    ['trailing dot', 'bad=api.openai.com.:443']
  ];

  for (const [reason, entry] of rejectedEntries) {
    it(`drops entries with ${reason} and warns`, () => {
      const { targets, warnings } = parseWithWarnings(`${entry},ok=example.org:443`);

      assert.deepEqual(targets, [{ label: 'ok', host: 'example.org', port: 443 }]);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /^MNG_HEALTH_CHECK_TARGETS: ignoring entry 1 /);
    });
  }

  it('explains URL-shaped entries as a host format error', () => {
    for (const entry of ['openai=https://api.openai.com:443', 'smtp=user:pass@smtp.gmail.com:465']) {
      const { warnings } = parseWithWarnings(entry);

      assert.match(warnings[0], /without scheme, credentials or path/);
    }
  });

  it('keeps the first entry when labels are duplicated', () => {
    const { targets, warnings } = parseWithWarnings('smtp=smtp.gmail.com:465,smtp=smtp.office365.com:587');

    assert.deepEqual(targets, [{ label: 'smtp', host: 'smtp.gmail.com', port: 465 }]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /duplicate label "smtp"/);
  });

  it(`keeps at most ${MAX_HEALTH_CHECK_TARGETS} targets`, () => {
    const entries = Array.from(
      { length: MAX_HEALTH_CHECK_TARGETS + 2 },
      (_, index) => `t${index}=host${index}.example.org:443`
    );
    const { targets, warnings } = parseWithWarnings(entries.join(','));

    assert.equal(targets.length, MAX_HEALTH_CHECK_TARGETS);
    assert.equal(targets.at(-1).label, `t${MAX_HEALTH_CHECK_TARGETS - 1}`);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /at most 20 targets are allowed/);
  });

  it('reads MNG_HEALTH_CHECK_TARGETS once and reuses the parsed list', () => {
    process.env.MNG_HEALTH_CHECK_TARGETS = 'smtp=smtp.gmail.com:465';
    const firstTargets = getHealthCheckTargets();

    process.env.MNG_HEALTH_CHECK_TARGETS = 'openai=api.openai.com:443';
    const secondTargets = getHealthCheckTargets();

    assert.equal(secondTargets, firstTargets);
    assert.deepEqual(secondTargets, [{ label: 'smtp', host: 'smtp.gmail.com', port: 465 }]);

    delete process.env.MNG_HEALTH_CHECK_TARGETS;
  });
});

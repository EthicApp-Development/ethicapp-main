import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AiServicesValidationError,
  POLICY_HISTORY_SQL,
  createAiServicesStore,
  normalizeConnectionUrl,
  parseConnectionInput,
  parsePolicyInput
} from '../ai-services.service.js';

function compactSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function createFakeQuery(responses) {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ sql: compactSql(text), params });
    const next = responses.shift();
    return typeof next === 'function' ? next(text, params) : next;
  };
  return { calls, query };
}

describe('AI services store input validation', () => {
  it('accepts http and https URLs with internal or external hosts and path prefixes', () => {
    const accepted = [
      ['http://ai-additions:8080', 'http://ai-additions:8080'],
      ['HTTPS://AI.example.org', 'HTTPS://AI.example.org'],
      [' https://ai.example.org/ ', 'https://ai.example.org'],
      ['https://ai.example.org//', 'https://ai.example.org'],
      ['https://ai.example.org/base', 'https://ai.example.org/base'],
      ['https://ai.example.org/base/', 'https://ai.example.org/base'],
      ['http://10.0.0.5:8080/ai-additions/v1', 'http://10.0.0.5:8080/ai-additions/v1'],
      ['http://[::1]:8080', 'http://[::1]:8080']
    ];

    for (const [input, canonical] of accepted) {
      assert.equal(normalizeConnectionUrl(input), canonical, input);
    }
  });

  it('stores canonical values that satisfy the V22 CHECK', () => {
    // Same expression as ai_additions_connection_base_url_check.
    const dbCheck = /^https?:\/\/[^/?#\s]+([/?#]\S*)?$/i;
    for (const input of ['http://ai-additions:8080/', 'https://ai.example.org/base/']) {
      assert.match(normalizeConnectionUrl(input), dbCheck);
    }
  });

  it('accepted URLs compose the token, JWKS, issuer and service paths', () => {
    // Plain string rules matching ethicapp's derivation from the stored
    // connection (base URL without trailing slash, then fixed suffixes).
    const realm = 'ethicapp-ai-additions';
    const compose = ({ baseUrl, keycloakPublicUrl }) => ({
      token: `${baseUrl}/keycloak/realms/${realm}/protocol/openid-connect/token`,
      jwks: `${baseUrl}/keycloak/realms/${realm}/protocol/openid-connect/certs`,
      issuer: `${keycloakPublicUrl || `${baseUrl}/keycloak`}/realms/${realm}`,
      service: `${baseUrl}/polyadic-agent/api`
    });

    const connection = parseConnectionInput({
      baseUrl: 'https://ai.example.org/base/',
      keycloakPublicUrl: 'https://auth.example.org/keycloak/'
    });
    const urls = compose(connection);

    assert.deepEqual(
      Object.fromEntries(Object.entries(urls).map(([key, value]) => {
        const parsed = new URL(value);
        return [key, { origin: parsed.origin, pathname: parsed.pathname, search: parsed.search }];
      })),
      {
        token: { origin: 'https://ai.example.org', pathname: `/base/keycloak/realms/${realm}/protocol/openid-connect/token`, search: '' },
        jwks: { origin: 'https://ai.example.org', pathname: `/base/keycloak/realms/${realm}/protocol/openid-connect/certs`, search: '' },
        issuer: { origin: 'https://auth.example.org', pathname: `/keycloak/realms/${realm}`, search: '' },
        service: { origin: 'https://ai.example.org', pathname: '/base/polyadic-agent/api', search: '' }
      }
    );

    const defaults = compose(parseConnectionInput({ baseUrl: 'http://ai-additions:8080' }));
    assert.equal(defaults.token, `http://ai-additions:8080/keycloak/realms/${realm}/protocol/openid-connect/token`);
    assert.equal(defaults.issuer, `http://ai-additions:8080/keycloak/realms/${realm}`);
  });

  it('rejects other schemes, missing authorities, queries, credentials, fragments, whitespace and non-strings', () => {
    for (const value of [
      'http:ai.example.org',
      'http:/ai.example.org',
      'http:///ai.example.org',
      'https:ai.example.org/keycloak',
      'http://',
      'http://:8080',
      'http://ai.example.org:99999',
      'https://ai.example.org/base?x=1',
      'https://ai.example.org?',
      'https://ai.example.org/?',
      'https://ai.example.org\\base',
      'https://ai.example.org/a/../b',
      'https://ai.example.org/./b',
      'ftp://ai.example.org',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://user:pass@ai.example.org',
      'https://user@ai.example.org',
      'http://@ai.example.org',
      'https://ai.example.org/#x',
      'https://ai.example.org/#',
      'https://ai example.org',
      'https://',
      'ai.example.org',
      `https://ai.example.org/${'a'.repeat(2048)}`,
      42,
      null
    ]) {
      assert.equal(normalizeConnectionUrl(value), null, String(value).slice(0, 60));
    }
  });

  it('applies the same rule and canonical form to the keycloak URL', () => {
    assert.deepEqual(parseConnectionInput({
      baseUrl: 'http://ai-additions:8080/',
      keycloakPublicUrl: 'https://ai.example.org/keycloak/'
    }), {
      baseUrl: 'http://ai-additions:8080',
      keycloakPublicUrl: 'https://ai.example.org/keycloak'
    });

    for (const keycloakPublicUrl of [
      'https://ai.example.org/keycloak?x=1',
      'http:///ai.example.org/keycloak',
      'https:ai.example.org/keycloak',
      'https://kc@ai.example.org/keycloak',
      'https://ai.example.org/keycloak#realm'
    ]) {
      assert.throws(
        () => parseConnectionInput({ baseUrl: 'https://ai.example.org', keycloakPublicUrl }),
        (error) => error.code === 'INVALID_KEYCLOAK_PUBLIC_URL',
        keycloakPublicUrl
      );
    }
  });

  it('treats a blank keycloak URL as not set', () => {
    assert.deepEqual(parseConnectionInput({ baseUrl: 'https://ai.example.org', keycloakPublicUrl: '  ' }), {
      baseUrl: 'https://ai.example.org',
      keycloakPublicUrl: null
    });
  });

  it('raises typed validation errors', () => {
    assert.throws(() => parseConnectionInput({ baseUrl: 'nope' }), (error) => (
      error instanceof AiServicesValidationError && error.code === 'INVALID_BASE_URL'
    ));
    assert.throws(() => parsePolicyInput({ allowedServiceIds: Array.from({ length: 101 }, (_, i) => `s${i}`) }), (error) => (
      error.code === 'INVALID_ALLOWED_SERVICE_IDS'
    ));
  });

  it('trims and deduplicates service ids and turns a blank note into null', () => {
    assert.deepEqual(parsePolicyInput({ allowedServiceIds: [' a ', 'b', 'a'], note: '   ' }), {
      allowedServiceIds: ['a', 'b'],
      note: null
    });
  });
});

describe('AI services store queries', () => {
  it('maps the connection row with the author name', async () => {
    const { query, calls } = createFakeQuery([{
      rows: [{
        base_url: 'https://ai.example.org',
        keycloak_public_url: null,
        updated_at: '2026-10-26T10:00:00.000Z',
        updated_by_id: 7,
        updated_by_firstname: 'Ada',
        updated_by_lastname: 'Lovelace',
        updated_by_mail: 'ada@example.org'
      }]
    }]);
    const store = createAiServicesStore({ query });

    assert.deepEqual(await store.getConnection(), {
      baseUrl: 'https://ai.example.org',
      keycloakPublicUrl: null,
      updatedAt: '2026-10-26T10:00:00.000Z',
      updatedBy: { id: 7, name: 'Ada Lovelace' }
    });
    assert.match(calls[0].sql, /FROM ai_additions_connection c LEFT JOIN users u/);
  });

  it('returns null when there is no connection row', async () => {
    const { query } = createFakeQuery([{ rows: [] }]);
    assert.equal(await createAiServicesStore({ query }).getConnection(), null);
  });

  it('upserts the single connection row with the operator as author', async () => {
    const { query, calls } = createFakeQuery([{ rowCount: 1, rows: [] }, { rows: [] }]);
    await createAiServicesStore({ query }).saveConnection({
      baseUrl: 'https://ai.example.org',
      keycloakPublicUrl: null,
      userId: 7
    });

    assert.match(calls[0].sql, /INSERT INTO ai_additions_connection .* VALUES \(1, \$1, \$2, now\(\), \$3\) ON CONFLICT \(id\) DO UPDATE/);
    assert.deepEqual(calls[0].params, ['https://ai.example.org', null, 7]);
  });

  it('deletes the connection row', async () => {
    const { query, calls } = createFakeQuery([{ rowCount: 1 }]);
    assert.equal(await createAiServicesStore({ query }).deleteConnection(), true);
    assert.equal(calls[0].sql, 'DELETE FROM ai_additions_connection WHERE id = 1');
  });

  it('counts only launched sessions in the history', () => {
    const sql = compactSql(POLICY_HISTORY_SQL);
    assert.match(
      sql,
      /WHERE s\.ai_service_policy_version_id = v\.id AND EXISTS \(SELECT 1 FROM activity a WHERE a\.session = s\.id\)/
    );
    assert.match(sql, /ORDER BY v\.id DESC$/);
  });

  it('maps history rows newest first, with the current version first', async () => {
    const { query } = createFakeQuery([{
      rows: [
        {
          id: '2',
          allowed_service_ids: ['polyadic-agent'],
          note: 'Pilot',
          created_at: '2026-10-26T10:00:00.000Z',
          created_by_id: 7,
          created_by_firstname: '',
          created_by_lastname: null,
          created_by_mail: 'ops@example.org',
          launched_session_count: 4
        },
        {
          id: '1',
          allowed_service_ids: [],
          note: 'Initial policy: no AI services are allowed.',
          created_at: '2026-10-25T10:00:00.000Z',
          created_by_id: null,
          launched_session_count: 0
        }
      ]
    }]);

    const history = await createAiServicesStore({ query }).getPolicyHistory();

    assert.equal(history.current.id, 2);
    assert.deepEqual(history.versions.map((version) => version.id), [2, 1]);
    assert.deepEqual(history.versions[0].createdBy, { id: 7, name: 'ops@example.org' });
    assert.equal(history.versions[0].launchedSessionCount, 4);
    assert.equal(history.versions[1].createdBy, null);
  });

  it('creates a version with an INSERT only, never an UPDATE or DELETE', async () => {
    const { query, calls } = createFakeQuery([
      { rows: [{ id: '3' }] },
      { rows: [{ id: '3', allowed_service_ids: ['a'], note: null, created_at: 'now', created_by_id: 7, launched_session_count: 0 }] }
    ]);

    const version = await createAiServicesStore({ query }).createPolicyVersion({
      allowedServiceIds: ['a'],
      note: null,
      userId: 7
    });

    assert.equal(version.id, 3);
    assert.match(calls[0].sql, /^INSERT INTO ai_service_policy_versions \(allowed_service_ids, note, created_by\) VALUES \(\$1::text\[\], \$2, \$3\) RETURNING id$/);
    assert.deepEqual(calls[0].params, [['a'], null, 7]);
    assert.ok(calls.every((call) => !/\b(UPDATE|DELETE)\b/.test(call.sql)));
  });
});

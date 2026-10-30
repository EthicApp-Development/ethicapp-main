import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveAccountStatus } from '../account-status.js';
import { buildListUsersFilter } from '../user.service.js';

test('buildListUsersFilter excludes anonymized users by default', () => {
  const filter = buildListUsersFilter();

  assert.equal(filter.whereSql, 'WHERE anonymized_at IS NULL');
  assert.deepEqual(filter.params, []);
});

test('buildListUsersFilter combines anonymized, keyword, and role filters', () => {
  const filter = buildListUsersFilter({
    keywords: '  Ana ProfesorA  ',
    role: ' p '
  });

  assert.match(filter.whereSql, /^WHERE anonymized_at IS NULL AND \(/);
  assert.match(filter.whereSql, /lower\(coalesce\(firstname, ''\)\) LIKE \$1/);
  assert.match(filter.whereSql, /lower\(coalesce\(lastname, ''\)\) LIKE \$1/);
  assert.match(filter.whereSql, /lower\(coalesce\(mail, ''\)\) LIKE \$1/);
  assert.match(filter.whereSql, /lower\(coalesce\(name, ''\)\) LIKE \$1/);
  assert.match(filter.whereSql, /lower\(coalesce\(rut, ''\)\) LIKE \$1/);
  assert.match(filter.whereSql, /role = \$2$/);
  assert.deepEqual(filter.params, ['%ana profesora%', 'P']);
});

test('buildListUsersFilter ignores invalid role filters while preserving anonymized filter', () => {
  const filter = buildListUsersFilter({ role: 'x' });

  assert.equal(filter.whereSql, 'WHERE anonymized_at IS NULL');
  assert.deepEqual(filter.params, []);
});

test('buildListUsersFilter filters pending accounts as never confirmed and inactive', () => {
  const filter = buildListUsersFilter({ role: 'A', status: ' Pending ' });

  assert.equal(
    filter.whereSql,
    'WHERE anonymized_at IS NULL AND role = $1 AND (active = false AND email_confirmed = false)'
  );
  assert.deepEqual(filter.params, ['A']);
});

test('buildListUsersFilter tells active and administrator-deactivated accounts apart', () => {
  assert.equal(
    buildListUsersFilter({ status: 'active' }).whereSql,
    'WHERE anonymized_at IS NULL AND (active IS NOT FALSE)'
  );
  assert.equal(
    buildListUsersFilter({ status: 'inactive' }).whereSql,
    'WHERE anonymized_at IS NULL AND (active = false AND email_confirmed IS NOT FALSE)'
  );
});

test('buildListUsersFilter ignores unknown status filters', () => {
  for (const status of ['anonymized', 'deleted', 'toString', '']) {
    const filter = buildListUsersFilter({ status });

    assert.equal(filter.whereSql, 'WHERE anonymized_at IS NULL', status);
    assert.deepEqual(filter.params, []);
  }
});

test('deriveAccountStatus distinguishes pending, deactivated, active and anonymized accounts', () => {
  assert.equal(deriveAccountStatus({ active: false, emailConfirmed: false }), 'pending');
  assert.equal(deriveAccountStatus({ active: false, emailConfirmed: true }), 'inactive');
  assert.equal(deriveAccountStatus({ active: false, emailConfirmed: null }), 'inactive');
  assert.equal(deriveAccountStatus({ active: true, emailConfirmed: true }), 'active');
  assert.equal(deriveAccountStatus({ active: null, emailConfirmed: true }), 'active');
  assert.equal(
    deriveAccountStatus({ active: false, emailConfirmed: false, anonymizedAt: '2026-07-01T03:00:00Z' }),
    'anonymized'
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

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

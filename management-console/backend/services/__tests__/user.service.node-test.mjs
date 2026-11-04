import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveAccountStatus } from '../account-status.js';
import {
  buildListUsersFilter,
  buildListUsersOrder,
  getUserById,
  listUsers,
  updateUserById
} from '../user.service.js';

function createFakeQuery(handler) {
  const calls = [];
  const queryFn = async (sql, params) => {
    calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params: [...params] });
    return handler(calls[calls.length - 1]);
  };

  return { calls, queryFn };
}

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
  assert.match(filter.whereSql, /role = \$2$/);
  assert.deepEqual(filter.params, ['%ana profesora%', 'P']);
});

test('listUsers does not match a RUT: it searches names and email only (#1070)', async () => {
  const { calls, queryFn } = createFakeQuery((call) => (
    call.sql.startsWith('SELECT count(*)') ? { rows: [{ total: 0 }] } : { rows: [] }
  ));

  await listUsers({ keywords: '12.345.678-5' }, { queryFn });

  for (const call of calls) {
    assert.doesNotMatch(call.sql, /\brut\b/i);
  }
  const searched = [...calls[0].sql.matchAll(/lower\(coalesce\((\w+), ''\)\) LIKE \$1/g)].map((match) => match[1]);
  assert.deepEqual(searched, ['firstname', 'lastname', 'mail', 'name']);
  assert.deepEqual(calls[0].params, ['%12.345.678-5%']);
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

test('buildListUsersOrder sorts newest accounts first by default', () => {
  for (const sort of [undefined, null, '', 'unknown']) {
    assert.deepEqual(buildListUsersOrder(sort), {
      sort: 'created_at_desc',
      orderSql: 'ORDER BY created_at DESC NULLS LAST, id DESC'
    });
  }
});

test('buildListUsersOrder sorts oldest accounts first, undated ones before dated ones', () => {
  assert.deepEqual(buildListUsersOrder(' CREATED_AT_ASC '), {
    sort: 'created_at_asc',
    orderSql: 'ORDER BY created_at ASC NULLS FIRST, id ASC'
  });
});

test('buildListUsersOrder only accepts whitelisted sort orders', () => {
  for (const sort of [
    'created_at; DROP TABLE users',
    'id DESC',
    'toString',
    '__proto__',
    ['created_at_asc', 'created_at_desc']
  ]) {
    assert.equal(buildListUsersOrder(sort).sort, 'created_at_desc');
  }
});

test('listUsers selects the creation date and orders the page by the requested sort', async () => {
  const { calls, queryFn } = createFakeQuery(({ sql }) => {
    if (sql.startsWith('SELECT count(*)')) {
      return { rows: [{ total: 2 }] };
    }

    return {
      rows: [
        {
          id: 3,
          firstname: 'Old',
          lastname: 'Account',
          mail: 'old@test',
          role: 'A',
          active: true,
          email_confirmed: true,
          created_at: null
        },
        {
          id: 9,
          firstname: 'New',
          lastname: 'Account',
          mail: 'new@test',
          role: 'P',
          active: false,
          email_confirmed: false,
          created_at: new Date('2026-10-29T12:00:00.000Z')
        }
      ]
    };
  });

  const result = await listUsers(
    { keywords: 'account', role: 'P', sort: 'created_at_asc', page: 2, pageSize: 5 },
    { queryFn }
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, ['%account%', 'P']);
  assert.match(calls[1].sql, /email_confirmed, created_at FROM users WHERE/);
  assert.match(calls[1].sql, /ORDER BY created_at ASC NULLS FIRST, id ASC LIMIT \$3 OFFSET \$4$/);
  assert.deepEqual(calls[1].params, ['%account%', 'P', 5, 5]);

  assert.equal(result.sort, 'created_at_asc');
  assert.equal(result.total, 2);
  assert.equal(result.totalPages, 1);
  assert.equal(result.items[0].createdAt, null);
  assert.deepEqual(result.items[1].createdAt, new Date('2026-10-29T12:00:00.000Z'));
});

test('listUsers combines the status filter and the sort: pending, oldest first', async () => {
  const { calls, queryFn } = createFakeQuery(({ sql }) => (
    sql.startsWith('SELECT count(*)') ? { rows: [{ total: 0 }] } : { rows: [] }
  ));

  const result = await listUsers({ status: 'pending', sort: 'created_at_asc' }, { queryFn });

  assert.equal(result.sort, 'created_at_asc');
  assert.ok(calls[1].sql.includes(
    'WHERE anonymized_at IS NULL AND (active = false AND email_confirmed = false) '
    + 'ORDER BY created_at ASC NULLS FIRST, id ASC LIMIT $1 OFFSET $2'
  ));
  assert.deepEqual(calls[1].params, [10, 0]);
});

test('listUsers falls back to the default sort for an unknown value', async () => {
  const { calls, queryFn } = createFakeQuery(({ sql }) => (
    sql.startsWith('SELECT count(*)') ? { rows: [{ total: 0 }] } : { rows: [] }
  ));

  const result = await listUsers({ sort: 'mail ASC' }, { queryFn });

  assert.equal(result.sort, 'created_at_desc');
  assert.match(calls[1].sql, /ORDER BY created_at DESC NULLS LAST, id DESC LIMIT \$1 OFFSET \$2$/);
  assert.doesNotMatch(calls[1].sql, /mail ASC/);
});

test('getUserById returns the creation date, or null when it is unknown', async () => {
  const createdAt = new Date('2026-10-29T12:00:00.000Z');
  const { calls, queryFn } = createFakeQuery(({ params }) => ({
    rowCount: 1,
    rows: [{
      id: params[0],
      firstname: 'Pat',
      lastname: 'Teacher',
      sex: 'O',
      mail: 'pat@test',
      role: 'P',
      active: true,
      email_confirmed: true,
      last_login_at: null,
      created_at: params[0] === 22 ? createdAt : null
    }]
  }));

  assert.deepEqual((await getUserById('22', { queryFn })).createdAt, createdAt);
  assert.equal((await getUserById('21', { queryFn })).createdAt, null);
  assert.match(calls[0].sql, /last_login_at, anonymized_at, created_at FROM users WHERE id = \$1/);
});

const EDIT = Object.freeze({
  firstname: 'Real',
  lastname: 'Name',
  sex: 'F',
  email: 'real@test',
  email_confirmation: 'real@test',
  role: 'A',
  active: true
});

// The fake answers the read of the account, the duplicate-email check, an
// UPDATE that matched no row (the account was forgotten or deleted after the
// read), and the re-read that tells the two apart.
function editRacingWith({ stillThere }) {
  return createFakeQuery(({ sql }) => {
    if (sql.startsWith('SELECT id, role, mail, active, anonymized_at')) {
      return { rowCount: 1, rows: [{ id: 7, role: 'A', mail: 'ana@test', active: true, anonymized_at: null }] };
    }
    if (sql.startsWith('UPDATE users')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql === 'SELECT 1 FROM users WHERE id = $1') {
      return { rowCount: stillThere ? 1 : 0, rows: stillThere ? [{}] : [] };
    }
    return { rowCount: 0, rows: [] };
  });
}

test('updateUserById writes only while the account is not anonymized', async () => {
  const { calls, queryFn } = editRacingWith({ stillThere: true });

  await assert.rejects(updateUserById(7, EDIT, { queryFn }), { message: 'ACCOUNT_ANONYMIZED' });
  assert.match(calls.find((call) => call.sql.startsWith('UPDATE users')).sql, /WHERE id = \$8 AND anonymized_at IS NULL/);
});

test('updateUserById reports an account deleted after its read as not found', async () => {
  const { queryFn } = editRacingWith({ stillThere: false });

  await assert.rejects(updateUserById(7, EDIT, { queryFn }), { message: 'USER_NOT_FOUND' });
});

const CURRENT_ACCOUNT = { id: 7, role: 'A', mail: 'ana@test', active: true, anonymized_at: null };

test('updateUserById checks the email ignoring letter case', async () => {
  const { calls, queryFn } = createFakeQuery(({ sql }) => {
    if (sql.startsWith('SELECT id, role, mail, active, anonymized_at')) {
      return { rowCount: 1, rows: [CURRENT_ACCOUNT] };
    }
    if (sql.startsWith('SELECT id FROM users WHERE lower(mail) = $1')) {
      return { rowCount: 1, rows: [{ id: 8 }] };
    }
    return { rowCount: 0, rows: [] };
  });

  await assert.rejects(
    updateUserById(7, { ...EDIT, email: 'Real@Test', email_confirmation: 'REAL@test' }, { queryFn }),
    { message: 'EMAIL_ALREADY_EXISTS' }
  );
  assert.deepEqual(calls[1].params, ['real@test', 7]);
  assert.equal(calls.some((call) => call.sql.startsWith('UPDATE users')), false);
});

// Another account takes the email between the duplicate check and the
// UPDATE: the unique index refuses the UPDATE, answered as the check does.
function editRefusedWith(failure) {
  return createFakeQuery(({ sql }) => {
    if (sql.startsWith('SELECT id, role, mail, active, anonymized_at')) {
      return { rowCount: 1, rows: [CURRENT_ACCOUNT] };
    }
    if (sql.startsWith('UPDATE users')) {
      throw failure;
    }
    return { rowCount: 0, rows: [] };
  });
}

for (const constraint of ['users_mail_lower_unique', 'users_mail_unique']) {
  test(`updateUserById reports a unique violation on ${constraint} as a duplicate email`, async () => {
    const { queryFn } = editRefusedWith(
      Object.assign(new Error('duplicate key value'), { code: '23505', constraint })
    );

    await assert.rejects(updateUserById(7, EDIT, { queryFn }), { message: 'EMAIL_ALREADY_EXISTS' });
  });
}

test('updateUserById passes on other database errors from the update', async () => {
  const failure = Object.assign(new Error('duplicate key value'), { code: '23505', constraint: 'other_unique' });
  const { queryFn } = editRefusedWith(failure);

  await assert.rejects(updateUserById(7, EDIT, { queryFn }), (error) => error === failure);
});

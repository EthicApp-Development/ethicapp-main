import { describe, test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const queryMock = mock.fn();

mock.module('../config/database.js', { namedExports: { query: queryMock } });

const { findById, findByLogin } = await import('./user.service.js');

describe('user.service', () => {
  beforeEach(() => {
    queryMock.mock.resetCalls();
    queryMock.mock.mockImplementation(() => Promise.resolve({ rowCount: 0, rows: [] }));
  });

  test('findByLogin matches the email only, ignoring letter case', async () => {
    const user = await findByLogin(' 12345678-9 ');

    assert.strictEqual(user, null);
    const [sql, params] = queryMock.mock.calls[0].arguments;
    assert.match(sql, /WHERE lower\(mail\) = \$1/);
    assert.doesNotMatch(sql, /\brut\b/);
    assert.deepStrictEqual(params, ['12345678-9']);
  });

  test('findById reads no national ID', async () => {
    queryMock.mock.mockImplementation(() => Promise.resolve({
      rowCount: 1,
      rows: [{ id: 3, name: 'Pat Teacher', mail: 'pat@example.com', role: 'P' }]
    }));

    const user = await findById(3);

    assert.doesNotMatch(queryMock.mock.calls[0].arguments[0], /\brut\b/);
    assert.strictEqual(user.email, 'pat@example.com');
    assert.ok(!Object.hasOwn(user, 'rut'));
  });
});

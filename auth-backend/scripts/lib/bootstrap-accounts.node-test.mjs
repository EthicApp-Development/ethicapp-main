import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createUserIfMissing,
  parseCreateUserArgs,
  readAdminConfig,
  reconcileAdmin
} from './bootstrap-accounts.js';

const fakeHash = async (password) => `hashed:${password}`;

// A fake database client that records statements and answers the email
// lookup from a list of stored emails, comparing them as lower(mail) does.
function createFakeDb({ storedMails = [], insertError = null } = {}) {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('SELECT id, mail')) {
        const index = storedMails.findIndex((mail) => mail.toLowerCase() === params[0]);
        return index === -1
          ? { rowCount: 0, rows: [] }
          : { rowCount: 1, rows: [{ id: index + 1, mail: storedMails[index] }] };
      }

      if (sql.includes('INSERT INTO users') && insertError) {
        throw insertError;
      }

      return { rowCount: 1, rows: [] };
    }
  };
}

const adminEnv = {
  ADMIN_FIRSTNAME: ' Ada ',
  ADMIN_LASTNAME: 'Admin',
  ADMIN_EMAIL: ' Admin@Example.com ',
  ADMIN_PASSWORD: 'ChangeMeNow!!'
};

describe('readAdminConfig', () => {
  test('needs no national ID', () => {
    const { config, missing } = readAdminConfig(adminEnv);

    assert.deepStrictEqual(missing, []);
    assert.deepStrictEqual(config, {
      firstname: 'Ada',
      lastname: 'Admin',
      email: 'admin@example.com',
      password: 'ChangeMeNow!!',
      sex: 'M'
    });
  });

  test('lists the empty required variables', () => {
    const { missing } = readAdminConfig({ ADMIN_FIRSTNAME: 'Ada', ADMIN_EMAIL: '  ' });

    assert.deepStrictEqual(missing, ['ADMIN_LASTNAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']);
  });
});

describe('reconcileAdmin', () => {
  test('creates the administrator without a national ID', async () => {
    const db = createFakeDb();
    const { config } = readAdminConfig(adminEnv);

    const outcome = await reconcileAdmin(db, config, { hash: fakeHash });

    assert.strictEqual(outcome, 'created');
    assert.match(db.calls[0].sql, /WHERE lower\(mail\) = \$1/);
    assert.deepStrictEqual(db.calls[0].params, ['admin@example.com']);
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO users'));
    assert.doesNotMatch(insert.sql, /\brut\b/);
    assert.deepStrictEqual(insert.params, [
      'Ada',
      'Admin',
      'Ada Admin',
      'admin@example.com',
      'M',
      'hashed:ChangeMeNow!!'
    ]);
  });

  test('reconciles the account whose email differs only in letter case', async () => {
    const db = createFakeDb({ storedMails: ['other@example.com', 'ADMIN@example.com'] });
    const { config } = readAdminConfig(adminEnv);

    const outcome = await reconcileAdmin(db, config, { hash: fakeHash });

    assert.strictEqual(outcome, 'reconciled');
    assert.ok(!db.calls.some((call) => call.sql.includes('INSERT INTO users')));
    const update = db.calls.find((call) => call.sql.includes('UPDATE users'));
    assert.doesNotMatch(update.sql, /\brut\b/);
    assert.match(update.sql, /role = 'S'/);
    assert.match(update.sql, /WHERE id = \$6/);
    assert.deepStrictEqual(update.params, ['Ada', 'Admin', 'Ada Admin', 'M', 'hashed:ChangeMeNow!!', 2]);
  });

  test('answers exists when the email is taken between the lookup and the insert', async () => {
    const db = createFakeDb({
      insertError: Object.assign(new Error('duplicate key value'), {
        code: '23505',
        constraint: 'users_mail_lower_unique'
      })
    });
    const { config } = readAdminConfig(adminEnv);

    assert.strictEqual(await reconcileAdmin(db, config, { hash: fakeHash }), 'exists');
  });

  test('propagates other database errors', async () => {
    const db = createFakeDb({ insertError: Object.assign(new Error('connection lost'), { code: '08006' }) });
    const { config } = readAdminConfig(adminEnv);

    await assert.rejects(reconcileAdmin(db, config, { hash: fakeHash }), /connection lost/);
  });
});

describe('parseCreateUserArgs', () => {
  test('reads the email third, with optional role and sex', () => {
    assert.deepStrictEqual(
      parseCreateUserArgs(['Pat', 'Teacher', ' Pat@Example.com ', 'secret!!', 'P', 'F']),
      {
        firstname: 'Pat',
        lastname: 'Teacher',
        email: 'pat@example.com',
        password: 'secret!!',
        role: 'P',
        sex: 'F'
      }
    );
    assert.strictEqual(parseCreateUserArgs(['Pat', 'Teacher', 'pat@example.com', 'secret!!']).role, 'A');
  });

  test('refuses incomplete arguments and an older call that passes a national ID third', () => {
    assert.strictEqual(parseCreateUserArgs(['Pat', 'Teacher', 'pat@example.com']), null);
    assert.strictEqual(
      parseCreateUserArgs(['Pat', 'Teacher', '11111111-1', 'pat@example.com', 'secret!!']),
      null
    );
  });
});

describe('createUserIfMissing', () => {
  const user = {
    firstname: 'Pat',
    lastname: 'Teacher',
    email: 'pat@example.com',
    password: 'secret!!',
    role: 'P',
    sex: 'F'
  };

  test('creates the user without a national ID', async () => {
    const db = createFakeDb();

    assert.deepStrictEqual(await createUserIfMissing(db, user, { hash: fakeHash }), { status: 'created' });
    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO users'));
    assert.doesNotMatch(insert.sql, /\brut\b/);
    assert.deepStrictEqual(insert.params, [
      'Pat',
      'Teacher',
      'Pat Teacher',
      'pat@example.com',
      'F',
      'P',
      'hashed:secret!!'
    ]);
  });

  test('changes nothing when an account has the email in another letter case', async () => {
    const db = createFakeDb({ storedMails: ['Pat@Example.com'] });

    assert.deepStrictEqual(await createUserIfMissing(db, user, { hash: fakeHash }), {
      status: 'exists',
      existingMail: 'Pat@Example.com'
    });
    assert.strictEqual(db.calls.length, 1);
  });

  test('answers exists when the email is taken between the lookup and the insert', async () => {
    const db = createFakeDb({ insertError: Object.assign(new Error('duplicate key value'), { code: '23505' }) });

    assert.deepStrictEqual(await createUserIfMissing(db, user, { hash: fakeHash }), {
      status: 'exists',
      existingMail: null
    });
  });
});

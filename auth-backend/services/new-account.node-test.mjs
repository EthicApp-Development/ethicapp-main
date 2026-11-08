import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  NEW_ACCOUNT_REFUSALS,
  hasRequiredNewAccountFields,
  isUniqueMailViolation,
  newAccountFieldsRefusal,
  newAccountFullName,
  readNewAccountFields
} from './new-account.js';

const PASSWORD = 'Strong-Pass!!1';

function fields(overrides = {}) {
  return readNewAccountFields({
    firstname: 'Ana',
    lastname: 'Rojas',
    gender: 'F',
    email: 'ana@example.test',
    password: PASSWORD,
    password_confirmation: PASSWORD,
    ...overrides
  });
}

describe('new account fields (#1170)', () => {
  test('trims the names and gender, and trims and lowercases the email', () => {
    assert.deepStrictEqual(readNewAccountFields({
      firstname: ' Ana ',
      lastname: ' Rojas ',
      gender: ' F ',
      email: ' Ana@Example.TEST ',
      password: ' spaced ',
      password_confirmation: ' spaced '
    }), {
      firstname: 'Ana',
      lastname: 'Rojas',
      gender: 'F',
      email: 'ana@example.test',
      password: ' spaced ',
      passwordConfirmation: ' spaced '
    });
  });

  test('reads values that are not strings as missing', () => {
    const read = readNewAccountFields({ firstname: 42, email: ['a@b.c'], password: { value: PASSWORD } });

    assert.strictEqual(read.firstname, '');
    assert.strictEqual(read.email, '');
    assert.strictEqual(read.password, '');
    assert.strictEqual(hasRequiredNewAccountFields(read), false);
    assert.strictEqual(hasRequiredNewAccountFields(readNewAccountFields()), false);
  });

  test('requires every field', () => {
    assert.strictEqual(hasRequiredNewAccountFields(fields()), true);
    for (const name of ['firstname', 'lastname', 'gender', 'email', 'password', 'password_confirmation']) {
      assert.strictEqual(hasRequiredNewAccountFields(fields({ [name]: '' })), false, name);
    }
  });

  test('refuses, in order, passwords that differ, a weak password and an unknown gender', () => {
    assert.strictEqual(newAccountFieldsRefusal(fields()), null);
    assert.strictEqual(
      newAccountFieldsRefusal(fields({ password: 'weak', password_confirmation: 'other', gender: 'X' })),
      'PASSWORDS_DO_NOT_MATCH'
    );
    assert.strictEqual(
      newAccountFieldsRefusal(fields({ password: 'weak', password_confirmation: 'weak', gender: 'X' })),
      'WEAK_PASSWORD'
    );
    assert.strictEqual(newAccountFieldsRefusal(fields({ gender: 'X' })), 'INVALID_GENDER');
    for (const gender of ['F', 'M', 'O']) {
      assert.strictEqual(newAccountFieldsRefusal(fields({ gender })), null);
    }
  });

  test('names a message for every refusal', () => {
    assert.deepStrictEqual(NEW_ACCOUNT_REFUSALS, {
      PASSWORDS_DO_NOT_MATCH: 'passwordsDoNotMatch',
      WEAK_PASSWORD: 'weakPassword',
      INVALID_GENDER: 'invalidGender'
    });
  });

  test('builds the full name from the first and last name', () => {
    assert.strictEqual(newAccountFullName(fields()), 'Ana Rojas');
  });

  test('recognizes the unique violation of the users email only', () => {
    assert.strictEqual(isUniqueMailViolation({ code: '23505', constraint: 'users_mail_lower_unique' }), true);
    assert.strictEqual(isUniqueMailViolation({ code: '23505', constraint: 'users_mail_key' }), true);
    assert.strictEqual(isUniqueMailViolation({ code: '23505', detail: 'Key (lower(mail))=(a@b.c) already exists.' }), true);
    assert.strictEqual(isUniqueMailViolation({ code: '23505', constraint: 'tags_code_key' }), false);
    assert.strictEqual(isUniqueMailViolation({ code: '08006', constraint: 'users_mail_lower_unique' }), false);
    assert.strictEqual(isUniqueMailViolation(null), false);
  });
});

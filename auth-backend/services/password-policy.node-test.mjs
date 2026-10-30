import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_SYMBOLS,
  countPasswordSymbols,
  getPasswordPolicy,
  isStrongPassword
} from './password-policy.js';

describe('password policy', () => {
  it('keeps the limits of the sign-up rule', () => {
    assert.strictEqual(PASSWORD_MIN_LENGTH, 10);
    assert.strictEqual(PASSWORD_MIN_SYMBOLS, 2);
    assert.deepStrictEqual(getPasswordPolicy(), { minLength: 10, minSymbols: 2 });
  });

  it('returns a fresh object each time', () => {
    const policy = getPasswordPolicy();
    policy.minLength = 1;
    assert.strictEqual(getPasswordPolicy().minLength, 10);
  });

  it('counts every character other than an ASCII letter or digit as a symbol', () => {
    assert.strictEqual(countPasswordSymbols('abcXYZ019'), 0);
    assert.strictEqual(countPasswordSymbols('a b!c-'), 3);
    assert.strictEqual(countPasswordSymbols('contraseña€'), 2);
    assert.strictEqual(countPasswordSymbols(undefined), 0);
  });

  it('accepts a password at both limits', () => {
    assert.strictEqual(isStrongPassword('abcdefgh!!'), true);
    assert.strictEqual(isStrongPassword('Str0ng-Pass!word'), true);
  });

  it('refuses a password below either limit', () => {
    assert.strictEqual(isStrongPassword('abcdefg!!'), false);
    assert.strictEqual(isStrongPassword('abcdefghi!'), false);
    assert.strictEqual(isStrongPassword('abcdefghijklmnop'), false);
  });

  it('refuses missing and non-string values', () => {
    for (const value of [undefined, null, '', 12345678901, ['abcdefgh!!'], { length: 20 }]) {
      assert.strictEqual(isStrongPassword(value), false, String(value));
    }
  });
});

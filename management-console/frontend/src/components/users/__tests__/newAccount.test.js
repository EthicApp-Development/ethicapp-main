import { describe, expect, it } from 'vitest';

import { checkPassword } from '../../common/passwordPolicy.js';
import { describeCreateAccountError } from '../createAccountErrors.js';
import {
  GENERATED_PASSWORD_MIN_LENGTH,
  GENERATED_PASSWORD_MIN_SYMBOLS,
  generatePassword,
  randomBelow
} from '../generatePassword.js';
import { canSubmitNewAccount, emptyNewAccount } from '../newAccountForm.js';

const POLICY = Object.freeze({ minLength: 10, minSymbols: 2 });
const ALLOWED = /^[abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*?+=]+$/;

function symbolsIn(password) {
  return (password.match(/[^a-zA-Z0-9]/g) || []).length;
}

describe('generatePassword (#1170)', () => {
  it('meets the policy, with at least the generator minimums', () => {
    for (let run = 0; run < 200; run += 1) {
      const password = generatePassword(POLICY);

      expect(password).toHaveLength(GENERATED_PASSWORD_MIN_LENGTH);
      expect(symbolsIn(password)).toBeGreaterThanOrEqual(GENERATED_PASSWORD_MIN_SYMBOLS);
      expect(checkPassword(password, POLICY).satisfied).toBe(true);
      expect(password).toMatch(ALLOWED);
      expect(password).toMatch(/[a-zA-Z]/);
      expect(password).toMatch(/[2-9]/);
    }
  });

  it('follows a policy stricter than its minimums, and works without one', () => {
    const strict = generatePassword({ minLength: 24, minSymbols: 5 });

    expect(strict).toHaveLength(24);
    expect(symbolsIn(strict)).toBeGreaterThanOrEqual(5);
    expect(generatePassword(null)).toHaveLength(GENERATED_PASSWORD_MIN_LENGTH);
  });

  it('gives different passwords from the browser random source', () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generatePassword(POLICY)));
    expect(passwords.size).toBe(20);
  });

  it('draws again a random value that would bias the remainder', () => {
    function source(values) {
      const draws = [...values];
      return {
        draws,
        randomValues: (array) => {
          array[0] = draws.shift();
          return array;
        }
      };
    }

    // 2^32 is not a multiple of 10: the top values are drawn again.
    const biased = source([0xFFFFFFFF, 0xFFFFFFFA, 7]);
    expect(randomBelow(10, biased.randomValues)).toBe(7);
    expect(biased.draws).toEqual([]);

    // 2 divides 2^32: every value is kept.
    const even = source([0xFFFFFFFF]);
    expect(randomBelow(2, even.randomValues)).toBe(1);
  });
});

describe('the new account form (#1170)', () => {
  function complete(overrides = {}) {
    return {
      ...emptyNewAccount('es_CL'),
      firstname: 'Ana',
      lastname: 'Rojas',
      email: 'ana@example.test',
      gender: 'F',
      role: 'P',
      password: 'Strong-Pass!!',
      password_confirmation: 'Strong-Pass!!',
      privacy_notice_confirmed: true,
      ...overrides
    };
  }

  it("starts empty, in the administrator's language", () => {
    expect(emptyNewAccount('es_CL')).toEqual({
      firstname: '',
      lastname: '',
      email: '',
      gender: '',
      role: '',
      preferred_locale: 'es_CL',
      password: '',
      password_confirmation: '',
      privacy_notice_confirmed: false
    });
    expect(emptyNewAccount('en_US').preferred_locale).toBe('en_US');
    expect(emptyNewAccount('fr_FR').preferred_locale).toBe('en_US');
  });

  it('may be submitted once complete', () => {
    expect(canSubmitNewAccount(complete(), POLICY)).toBe(true);
    // Without the policy, auth-backend alone checks the password.
    expect(canSubmitNewAccount(complete({ password: 'weak', password_confirmation: 'weak' }), null)).toBe(true);
  });

  it.each([
    ['a blank name', { firstname: '  ' }],
    ['no email', { email: '' }],
    ['no gender', { gender: '' }],
    ['no role', { role: '' }],
    ['the administrator role', { role: 'S' }],
    ['passwords that differ', { password_confirmation: 'Strong-Pass!?' }],
    ['a weak password', { password: 'weak!!', password_confirmation: 'weak!!' }],
    ['the privacy notice unconfirmed', { privacy_notice_confirmed: false }]
  ])('may not be submitted with %s', (label, overrides) => {
    expect(canSubmitNewAccount(complete(overrides), POLICY)).toBe(false);
  });
});

describe('describeCreateAccountError (#1170)', () => {
  const t = (key) => `t:${key}`;

  function refusal(code, message) {
    return Object.assign(new Error(code), { code, body: { error: code, message } });
  }

  it("shows auth-backend's message for a refused field", () => {
    for (const code of ['WEAK_PASSWORD', 'INVALID_EMAIL', 'PASSWORDS_DO_NOT_MATCH', 'REQUIRED_FIELDS_MISSING']) {
      expect(describeCreateAccountError(refusal(code, 'localized'), t)).toBe('localized');
    }
  });

  it("uses the console's own text for an existing email and a missing privacy confirmation", () => {
    expect(describeCreateAccountError(refusal('EMAIL_ALREADY_REGISTERED', 'Ya existe'), t))
      .toBe('t:pages.userCreate.errors.emailAlreadyRegistered');
    expect(describeCreateAccountError(Object.assign(new Error('PRIVACY_NOTICE_NOT_CONFIRMED'), {
      code: 'PRIVACY_NOTICE_NOT_CONFIRMED',
      body: { error: 'PRIVACY_NOTICE_NOT_CONFIRMED' }
    }), t)).toBe('t:pages.userCreate.errors.privacyNoticeNotConfirmed');
  });

  it('falls back to the generic message', () => {
    expect(describeCreateAccountError(refusal('AUTH_BACKEND_ERROR'), t)).toBe('t:pages.userCreate.error');
    expect(describeCreateAccountError(refusal('WEAK_PASSWORD'), t)).toBe('t:pages.userCreate.error');
    expect(describeCreateAccountError(new Error('Failed to fetch'), t)).toBe('t:pages.userCreate.error');
  });
});

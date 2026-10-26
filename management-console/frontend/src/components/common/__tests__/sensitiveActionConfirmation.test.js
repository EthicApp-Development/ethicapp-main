import { describe, expect, it, vi } from 'vitest';

import enUS from '../../../i18n/locales/en_US.js';
import esCL from '../../../i18n/locales/es_CL.js';
import {
  CONFIRMATION_METHODS,
  PASSKEY_FAILED_KEY,
  attemptConfirmation,
  buildStepUpPayload,
  canSubmitConfirmation,
  passkeysSupported,
  stepUpErrorKey
} from '../sensitiveActionConfirmation.js';

// Errors as the API clients throw them: `code` is the backend `error` value.
function apiError(code) {
  return Object.assign(new Error(code), { code });
}

function lookup(dictionary, key) {
  return key.split('.').reduce((node, part) => node?.[part], dictionary);
}

const BACKEND_ERRORS = {
  PASSKEY_REQUIRED: 'sensitiveAction.errors.passkeyRequired',
  'Invalid administrator passkey': 'sensitiveAction.errors.invalidPasskey',
  'Invalid administrator password': 'sensitiveAction.errors.invalidPassword',
  'Invalid recaptcha token': 'sensitiveAction.errors.invalidRecaptcha'
};

describe('stepUpErrorKey', () => {
  for (const [code, key] of Object.entries(BACKEND_ERRORS)) {
    it(`maps "${code}" to a message defined in both locales`, () => {
      expect(stepUpErrorKey(apiError(code))).toBe(key);
      expect(stepUpErrorKey(new Error(code))).toBe(key);
      expect(typeof lookup(enUS, key)).toBe('string');
      expect(typeof lookup(esCL, key)).toBe('string');
    });
  }

  it('leaves other errors to the caller', () => {
    expect(stepUpErrorKey(apiError('INVALID_BASE_URL'))).toBeNull();
    expect(stepUpErrorKey(apiError('SESSION_EXPIRED'))).toBeNull();
    expect(stepUpErrorKey(undefined)).toBeNull();
  });
});

describe('buildStepUpPayload', () => {
  it('sends the password and reCAPTCHA token', async () => {
    const getPasskeyAssertion = vi.fn();
    const payload = await buildStepUpPayload({
      method: CONFIRMATION_METHODS.password,
      password: 'admin-secret',
      recaptchaToken: 'token-1',
      getPasskeyAssertion
    });

    expect(payload).toEqual({ admin_password: 'admin-secret', recaptcha_token: 'token-1' });
    expect(getPasskeyAssertion).not.toHaveBeenCalled();
  });

  it('sends only the passkey assertion', async () => {
    const payload = await buildStepUpPayload({
      method: CONFIRMATION_METHODS.passkey,
      password: 'ignored',
      recaptchaToken: 'ignored',
      getPasskeyAssertion: async () => ({ id: 'credential-1' })
    });

    expect(payload).toEqual({ passkey_assertion: { id: 'credential-1' } });
  });
});

describe('attemptConfirmation', () => {
  const passwordAttempt = (action) => attemptConfirmation({
    method: CONFIRMATION_METHODS.password,
    password: 'admin-secret',
    recaptchaToken: 'token-1',
    getPasskeyAssertion: async () => ({ id: 'credential-1' }),
    action
  });

  it('runs the action with the step-up fields and returns its result', async () => {
    const action = vi.fn(async () => ({ id: 3 }));

    await expect(passwordAttempt(action)).resolves.toEqual({ status: 'done', result: { id: 3 } });
    expect(action).toHaveBeenCalledWith({ admin_password: 'admin-secret', recaptcha_token: 'token-1' });
  });

  it('keeps the dialog open with the error for a wrong password or a failed reCAPTCHA', async () => {
    for (const code of ['Invalid administrator password', 'Invalid recaptcha token']) {
      await expect(passwordAttempt(async () => { throw apiError(code); })).resolves.toEqual({
        status: 'retry',
        errorKey: BACKEND_ERRORS[code],
        method: CONFIRMATION_METHODS.password
      });
    }
  });

  it('switches to the passkey on PASSKEY_REQUIRED', async () => {
    await expect(passwordAttempt(async () => { throw apiError('PASSKEY_REQUIRED'); })).resolves.toEqual({
      status: 'retry',
      errorKey: 'sensitiveAction.errors.passkeyRequired',
      method: CONFIRMATION_METHODS.passkey
    });
  });

  it('reports an invalid passkey and a passkey prompt that did not complete, sending nothing for the latter', async () => {
    const rejected = await attemptConfirmation({
      method: CONFIRMATION_METHODS.passkey,
      getPasskeyAssertion: async () => ({ id: 'credential-1' }),
      action: async () => { throw apiError('Invalid administrator passkey'); }
    });
    expect(rejected).toEqual({ status: 'retry', errorKey: 'sensitiveAction.errors.invalidPasskey', method: 'passkey' });

    const action = vi.fn();
    const dismissed = await attemptConfirmation({
      method: CONFIRMATION_METHODS.passkey,
      getPasskeyAssertion: async () => { throw Object.assign(new Error('dismissed'), { name: 'NotAllowedError' }); },
      action
    });
    expect(dismissed).toEqual({ status: 'retry', errorKey: PASSKEY_FAILED_KEY, method: 'passkey' });
    expect(action).not.toHaveBeenCalled();
    expect(typeof lookup(enUS, PASSKEY_FAILED_KEY)).toBe('string');
    expect(typeof lookup(esCL, PASSKEY_FAILED_KEY)).toBe('string');
  });

  it('rejects with errors that are not about the confirmation', async () => {
    await expect(passwordAttempt(async () => { throw apiError('INVALID_BASE_URL'); }))
      .rejects.toMatchObject({ code: 'INVALID_BASE_URL' });

    await expect(attemptConfirmation({
      method: CONFIRMATION_METHODS.passkey,
      getPasskeyAssertion: async () => { throw apiError('SESSION_EXPIRED'); },
      action: vi.fn()
    })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});

describe('canSubmitConfirmation', () => {
  const base = {
    method: CONFIRMATION_METHODS.password,
    busy: false,
    password: 'admin-secret',
    recaptchaToken: 'token-1',
    recaptchaRequired: true,
    passkeySupport: true
  };

  it('needs a password and, when the widget is shown, a reCAPTCHA token', () => {
    expect(canSubmitConfirmation(base)).toBe(true);
    expect(canSubmitConfirmation({ ...base, password: '' })).toBe(false);
    expect(canSubmitConfirmation({ ...base, recaptchaToken: '' })).toBe(false);
    expect(canSubmitConfirmation({ ...base, recaptchaToken: '', recaptchaRequired: false })).toBe(true);
  });

  it('needs browser support for a passkey', () => {
    const passkey = { ...base, method: CONFIRMATION_METHODS.passkey, password: '', recaptchaToken: '' };
    expect(canSubmitConfirmation(passkey)).toBe(true);
    expect(canSubmitConfirmation({ ...passkey, passkeySupport: false })).toBe(false);
  });

  it('waits while busy or while the method is unknown', () => {
    expect(canSubmitConfirmation({ ...base, busy: true })).toBe(false);
    expect(canSubmitConfirmation({ ...base, method: CONFIRMATION_METHODS.loading })).toBe(false);
  });
});

describe('passkeysSupported', () => {
  it('detects WebAuthn support', () => {
    expect(passkeysSupported({ PublicKeyCredential: function PublicKeyCredential() {} })).toBe(true);
    expect(passkeysSupported({})).toBe(false);
    expect(passkeysSupported(undefined)).toBe(false);
  });
});

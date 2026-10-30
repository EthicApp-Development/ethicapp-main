import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import enUS from '../../../i18n/locales/en_US.js';
import esCL from '../../../i18n/locales/es_CL.js';
import { SensitiveActionConfirmContent } from '../SensitiveActionConfirmModal.jsx';

// Without an I18n provider, t() returns the translation key, so assertions
// look for keys instead of localized text.
const noop = () => {};

function render(props = {}) {
  return renderToStaticMarkup(
    <SensitiveActionConfirmContent
      title="Save the AI Additions connection?"
      description="EthicApp will reach AI Additions at https://ai.example.org."
      details="Running activities follow the new connection."
      confirmLabel="Save connection"
      method="password"
      passkeySupport
      password=""
      onPasswordChange={noop}
      busy={false}
      errorKey=""
      canConfirm={false}
      recaptchaProvider="classic"
      recaptchaSiteKey="test-site-key"
      recaptchaResetCounter={0}
      onRecaptchaChange={noop}
      onCancel={noop}
      onConfirm={noop}
      {...props}
    />
  );
}

function keysOf(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => (
    value && typeof value === 'object' ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  ));
}

describe('sensitive action confirmation dialog', () => {
  it('explains the action and asks for the password and reCAPTCHA', () => {
    const html = render();

    expect(html).toContain('Save the AI Additions connection?');
    expect(html).toContain('EthicApp will reach AI Additions at https://ai.example.org.');
    expect(html).toContain('Running activities follow the new connection.');
    expect(html).toContain('sensitiveAction.passwordIntro');
    expect(html).toContain('data-confirmation-method="password"');
    expect(html).toMatch(/<label[^>]*for="sensitive-action-password"[^>]*>sensitiveAction.fields.adminPassword<\/label>/);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*id="sensitive-action-password"|<input[^>]*id="sensitive-action-password"[^>]*type="password"/);
    expect(html).toContain('data-testid="sensitive-action-recaptcha"');
    expect(html).toContain('data-testid="sensitive-action-cancel"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*data-testid="sensitive-action-confirm"[^>]*>Save connection</);
    expect(html).not.toContain('sensitive-action-error');
    expect(html).not.toContain('sensitiveAction.passkeyHelp');
  });

  it('enables the confirm button once the confirmation can be sent', () => {
    const html = render({ password: 'admin-secret', canConfirm: true });
    expect(html).not.toMatch(/disabled=""[^>]*data-testid="sensitive-action-confirm"/);
  });

  it('shows a refused confirmation in place', () => {
    const html = render({ errorKey: 'sensitiveAction.errors.invalidPassword' });
    expect(html).toMatch(/role="alert"[^>]*data-testid="sensitive-action-error"|data-testid="sensitive-action-error"[^>]*role="alert"/);
    expect(html).toContain('sensitiveAction.errors.invalidPassword');
  });

  it('asks for the passkey instead when the administrator has one', () => {
    const html = render({ method: 'passkey', canConfirm: true });

    expect(html).toContain('data-confirmation-method="passkey"');
    expect(html).toContain('sensitiveAction.passkeyIntro');
    expect(html).toContain('data-testid="sensitive-action-passkey-help"');
    expect(html).toContain('sensitiveAction.actions.confirmWithPasskey');
    expect(html).not.toContain('sensitive-action-password');
    expect(html).not.toContain('sensitive-action-recaptcha');
  });

  it('explains that this browser cannot use the passkey and cannot confirm', () => {
    const html = render({ method: 'passkey', passkeySupport: false, canConfirm: false });

    expect(html).toContain('data-testid="sensitive-action-passkey-unsupported"');
    expect(html).toContain('sensitiveAction.passkeyUnsupported');
    expect(html).toMatch(/disabled=""[^>]*data-testid="sensitive-action-confirm"/);
  });

  it('waits while it learns whether the administrator has passkeys', () => {
    const html = render({ method: 'loading' });
    expect(html).toContain('sensitiveAction.loading');
    expect(html).not.toContain('sensitive-action-password');
  });

  it('cannot be cancelled while the action runs', () => {
    const html = render({ password: 'admin-secret', busy: true });
    expect(html).toMatch(/disabled=""[^>]*data-testid="sensitive-action-cancel"/);
    expect(html).not.toContain('btn-close');
  });
});

describe('sensitive action translations', () => {
  it('defines every key in both locales', () => {
    const sections = (locale) => ({
      sensitiveAction: locale.sensitiveAction,
      userShow: locale.pages.userShow
    });
    expect(keysOf(sections(esCL)).sort()).toEqual(keysOf(sections(enUS)).sort());
  });

  it('defines the dialog texts of each user action', () => {
    for (const locale of [enUS, esCL]) {
      for (const action of ['save', 'confirmAccount', 'passwordReset', 'impersonation']) {
        expect(Object.keys(locale.pages.userShow.confirm[action]).sort()).toEqual(['body', 'confirm', 'title']);
      }
    }
  });
});

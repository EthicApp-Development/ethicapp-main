import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

const originalEnv = { ...process.env };
const createTransportMock = mock.fn();

mock.module('nodemailer', {
  defaultExport: {
    createTransport: createTransportMock
  }
});

function resetEnv() {
  process.env = { ...originalEnv };
}

async function importMailService(testName) {
  return import(`./mail.service.js?test=${encodeURIComponent(testName)}-${Date.now()}`);
}

afterEach(() => {
  resetEnv();
  createTransportMock.mock.resetCalls();
  createTransportMock.mock.restore();
});

test('sendPasswordResetEmail supports unauthenticated SMTP transport', async () => {
  const sendMailMock = mock.fn(() => Promise.resolve());
  let transportOptions;

  process.env.SMTP_HOST = 'smtp.uva.es';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_SECURE = 'true';
  process.env.SMTP_FROM = 'EthicApp <no-reply@uva.es>';
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  createTransportMock.mock.mockImplementationOnce(options => {
    transportOptions = options;
    return { sendMail: sendMailMock };
  });

  const { sendPasswordResetEmail } = await importMailService('unauthenticated-smtp');

  await sendPasswordResetEmail({
    to: 'recipient@example.com',
    rawToken: 'reset-token',
    preferredLocale: 'es_CL'
  });

  assert.deepStrictEqual(transportOptions, {
    host: 'smtp.uva.es',
    port: 465,
    secure: true
  });
  assert.equal(sendMailMock.mock.calls.length, 1);
  assert.equal(sendMailMock.mock.calls[0].arguments[0].from, 'EthicApp <no-reply@uva.es>');
});

test('sendPasswordResetEmail rejects partial SMTP authentication config', async () => {
  process.env.SMTP_HOST = 'smtp.uva.es';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_SECURE = 'true';
  process.env.SMTP_FROM = 'EthicApp <no-reply@uva.es>';
  process.env.SMTP_USER = 'mailer@uva.es';
  delete process.env.SMTP_PASS;

  const { sendPasswordResetEmail } = await importMailService('partial-smtp-auth');

  await assert.rejects(
    () => sendPasswordResetEmail({
      to: 'recipient@example.com',
      rawToken: 'reset-token',
      preferredLocale: 'es_CL'
    }),
    /SMTP authentication configuration is incomplete/
  );

  assert.equal(createTransportMock.mock.calls.length, 0);
});

for (const [locale, subject, privacyText, termsText] of [
  ['es_CL', 'Tu cuenta de EthicApp', 'política de privacidad', 'términos de uso'],
  ['en_US', 'Your EthicApp account', 'privacy policy', 'terms of use']
]) {
  test(`sendAccountCreatedByAdminEmail links sign-in, recovery, privacy and terms (${locale}) (#1170)`, async () => {
    const sendMailMock = mock.fn(() => Promise.resolve());

    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_FROM = 'EthicApp <no-reply@example.test>';
    process.env.AUTH_PUBLIC_URL = 'https://ethicapp.example.test/';
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    createTransportMock.mock.mockImplementationOnce(() => ({ sendMail: sendMailMock }));

    const { sendAccountCreatedByAdminEmail } = await importMailService(`account-created-${locale}`);

    const result = await sendAccountCreatedByAdminEmail({
      to: 'ana@example.test',
      firstname: 'Ana <b>',
      preferredLocale: locale.replace('_', '-')
    });

    assert.deepStrictEqual(result, {
      loginUrl: 'https://ethicapp.example.test/login',
      forgotUrl: 'https://ethicapp.example.test/forgot',
      privacyUrl: 'https://ethicapp.example.test/privacy',
      termsUrl: 'https://ethicapp.example.test/terms',
      preferredLocale: locale
    });

    assert.equal(sendMailMock.mock.calls.length, 1);
    const message = sendMailMock.mock.calls[0].arguments[0];
    assert.equal(message.to, 'ana@example.test');
    assert.equal(message.subject, subject);
    for (const url of ['/login', '/forgot', '/privacy', '/terms']) {
      assert.ok(message.html.includes(`href="https://ethicapp.example.test${url}"`), url);
    }
    assert.ok(message.html.includes(privacyText));
    assert.ok(message.html.includes(termsText));
    assert.ok(message.html.includes('ana@example.test'));
    // The first name is escaped.
    assert.ok(message.html.includes('Ana &lt;b&gt;'));
    assert.ok(!message.html.includes('Ana <b>'));
  });
}

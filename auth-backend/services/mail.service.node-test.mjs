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

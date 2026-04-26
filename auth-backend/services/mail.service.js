const path = require('path');
const ejs = require('ejs');
const nodemailer = require('nodemailer');

const EMAIL_TEMPLATES_PATH = path.join(__dirname, '..', 'views', 'emails');
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const AUTH_PUBLIC_URL = process.env.AUTH_PUBLIC_URL || 'http://localhost:3000';
const RESET_TOKEN_TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60);
const SUPPORTED_LOCALES = new Set(['es_CL', 'en_US']);
const DEFAULT_LOCALE = 'en_US';

const forgotPasswordSubjects = {
  es_CL: 'Recuperación de contraseña',
  en_US: 'Password reset'
};

function ensureSmtpConfig() {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    throw new Error(
      'SMTP configuration is incomplete. Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM'
    );
  }
}

function normalizePreferredLocale(locale) {
  const normalized = String(locale || '').trim().toLowerCase().replace('-', '_');

  if (normalized.startsWith('es_') || normalized === 'es') {
    return 'es_CL';
  }

  return 'en_US';
}

function resolvePreferredLocale(locale) {
  const normalizedLocale = normalizePreferredLocale(locale);
  return SUPPORTED_LOCALES.has(normalizedLocale) ? normalizedLocale : DEFAULT_LOCALE;
}

function buildResetUrl(rawToken) {
  const normalizedBaseUrl = AUTH_PUBLIC_URL.endsWith('/')
    ? AUTH_PUBLIC_URL.slice(0, -1)
    : AUTH_PUBLIC_URL;

  return `${normalizedBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

function createTransporter() {
  ensureSmtpConfig();

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

async function renderForgotPasswordHtml({ preferredLocale, templateData }) {
  const resolvedLocale = resolvePreferredLocale(preferredLocale);
  const templateFileName = `forgot-password.${resolvedLocale}.ejs`;
  const templatePath = path.join(EMAIL_TEMPLATES_PATH, templateFileName);

  return ejs.renderFile(templatePath, templateData);
}

async function sendPasswordResetEmail({ to, rawToken, preferredLocale }) {
  const resolvedLocale = resolvePreferredLocale(preferredLocale);
  const resetUrl = buildResetUrl(rawToken);
  const html = await renderForgotPasswordHtml({
    preferredLocale: resolvedLocale,
    templateData: {
      resetUrl,
      resetTokenTtlMinutes: RESET_TOKEN_TTL_MINUTES
    }
  });

  const transporter = createTransporter();

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: forgotPasswordSubjects[resolvedLocale],
    html
  });

  return {
    resetUrl,
    preferredLocale: resolvedLocale
  };
}

module.exports = {
  sendPasswordResetEmail,
  buildResetUrl,
  normalizePreferredLocale,
  resolvePreferredLocale
};

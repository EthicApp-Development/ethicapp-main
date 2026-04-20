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

function ensureSmtpConfig() {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    throw new Error(
      'SMTP configuration is incomplete. Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM'
    );
  }
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

async function renderForgotPasswordHtml(templateData) {
  const templatePath = path.join(EMAIL_TEMPLATES_PATH, 'forgot-password.ejs');

  return ejs.renderFile(templatePath, templateData);
}

async function sendPasswordResetEmail({ to, rawToken }) {
  const resetUrl = buildResetUrl(rawToken);
  const html = await renderForgotPasswordHtml({
    resetUrl,
    resetTokenTtlMinutes: Number(process.env.RESET_TOKEN_TTL_MINUTES || 60)
  });

  const transporter = createTransporter();

  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: 'Recuperación de contraseña',
    html
  });

  return {
    resetUrl
  };
}

module.exports = {
  sendPasswordResetEmail,
  buildResetUrl
};

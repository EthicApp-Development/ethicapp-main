import express from 'express';

import { pool as defaultPool } from '../config/database.js';
import authMessages from '../i18n/messages/auth-messages.js';
import { inferPreferredLocaleFromRequest, normalizePreferredLocale, translateMessage } from '../i18n/locale.js';
import { hasValidInternalServiceToken } from '../middleware/csrfProtection.js';
import { sendAccountCreatedByAdminEmail } from '../services/mail.service.js';
import {
  hasRequiredNewAccountFields,
  isUniqueMailViolation,
  newAccountFieldsRefusal,
  newAccountFullName,
  readNewAccountFields
} from '../services/new-account.js';
import { hashPassword as defaultHashPassword } from '../services/password.service.js';

// An administrator creates a student or teacher account (#1170), typically
// to prepare a pilot's teachers or to let in a student who arrives at a
// session without an account. The account starts active, with its email
// confirmed; the administrator hands the password to the user outside
// EthicApp, and the user receives a welcome email without it.
//
// Only management-console's backend calls this route, after its own step-up
// confirmation: it requires the internal service token as well as a role S
// session, and NGINX does not serve it at the edge.
//
// The password never leaves this module: it is not echoed in responses, and
// the insert runs on a dedicated client, so the SQL error log of
// config/database.js never sees the hash either.

// Machine-readable refusal codes; management-console audits them and its
// frontend translates them, so they are part of the API contract.
export const ADMIN_CREATE_ACCOUNT_ERRORS = Object.freeze({
  internalServiceTokenRequired: 'INTERNAL_SERVICE_TOKEN_REQUIRED',
  unauthenticated: 'UNAUTHENTICATED',
  unauthorized: 'UNAUTHORIZED',
  requiredFieldsMissing: 'REQUIRED_FIELDS_MISSING',
  invalidRole: 'INVALID_ROLE',
  invalidEmail: 'INVALID_EMAIL',
  passwordsDoNotMatch: 'PASSWORDS_DO_NOT_MATCH',
  weakPassword: 'WEAK_PASSWORD',
  invalidGender: 'INVALID_GENDER',
  emailAlreadyRegistered: 'EMAIL_ALREADY_REGISTERED'
});

const ERRORS = ADMIN_CREATE_ACCOUNT_ERRORS;

// Status and message key of each refusal.
const REFUSALS = Object.freeze({
  [ERRORS.internalServiceTokenRequired]: { status: 403, messageKey: 'unauthorized' },
  [ERRORS.unauthenticated]: { status: 401, messageKey: 'unauthenticated' },
  [ERRORS.unauthorized]: { status: 403, messageKey: 'unauthorized' },
  [ERRORS.requiredFieldsMissing]: { status: 400, messageKey: 'requiredFieldsMissing' },
  [ERRORS.invalidRole]: { status: 400, messageKey: 'invalidRole' },
  [ERRORS.invalidEmail]: { status: 400, messageKey: 'invalidEmail' },
  [ERRORS.passwordsDoNotMatch]: { status: 400, messageKey: 'passwordsDoNotMatch' },
  [ERRORS.weakPassword]: { status: 400, messageKey: 'weakPassword' },
  [ERRORS.invalidGender]: { status: 400, messageKey: 'invalidGender' },
  [ERRORS.emailAlreadyRegistered]: { status: 409, messageKey: 'emailAlreadyRegistered' }
});

// Roles an administrator may create here: students and teachers.
const ROLES_ALLOWED = new Set(['A', 'P']);

// How long the answer waits for the welcome email. NGINX and the console
// wait far longer for auth-backend.
export const WELCOME_EMAIL_TIMEOUT_MS = 10000;

// One "@" with something on each side and a dot in the domain: enough to
// catch a slip of the keyboard, which a confirmed account would otherwise
// keep, without judging addresses the mail server would accept.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Messages go to the administrator, in the language of their browser. The
// body's preferred_locale is the new account's, so it is left out here.
function t(req, key) {
  return translateMessage({ headers: req.headers }, key, authMessages);
}

function refuse(req, res, code) {
  const { status, messageKey } = REFUSALS[code];
  return res.status(status).json({ error: t(req, messageKey), code });
}

function readRole(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

// The new account's locale: the one the administrator chose, or else the
// administrator's own, normalized with the canonical rule.
function readPreferredLocale(req) {
  const chosen = typeof req.body?.preferred_locale === 'string' ? req.body.preferred_locale.trim() : '';
  return normalizePreferredLocale(chosen || inferPreferredLocaleFromRequest({ headers: req.headers }));
}

// The first refusal of the request body, or null.
function bodyRefusal(fields, role) {
  if (!hasRequiredNewAccountFields(fields) || !role) {
    return ERRORS.requiredFieldsMissing;
  }

  if (!ROLES_ALLOWED.has(role)) {
    return ERRORS.invalidRole;
  }

  if (!EMAIL_SHAPE.test(fields.email)) {
    return ERRORS.invalidEmail;
  }

  return newAccountFieldsRefusal(fields);
}

export function createAdminUserAccountRouter({
  pool = defaultPool,
  hashPassword = defaultHashPassword,
  hasInternalServiceToken = hasValidInternalServiceToken,
  sendWelcomeEmail = sendAccountCreatedByAdminEmail,
  welcomeEmailTimeoutMs = WELCOME_EMAIL_TIMEOUT_MS,
  logger = console
} = {}) {
  const router = express.Router();

  // Inserts the account, active and with its email confirmed, on a dedicated
  // client. users_mail_lower_unique refuses an email already registered in
  // any letter case. Resolves to the new id.
  async function insertAccount({ fields, role, preferredLocale, passwordHash }) {
    const client = await pool.connect();

    try {
      const result = await client.query(
        `
          INSERT INTO users
            (firstname, lastname, name, sex, mail, role, preferred_locale,
             password_bcrypt, auth_provider, active, email_confirmed)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, 'local', true, true)
          RETURNING id
        `,
        [
          fields.firstname,
          fields.lastname,
          newAccountFullName(fields),
          fields.gender,
          fields.email,
          role,
          preferredLocale,
          passwordHash
        ]
      );

      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  // The welcome email, best effort: the account stays whatever happens to
  // it. Resolves to whether it was sent within welcomeEmailTimeoutMs. A slow
  // SMTP server must not hold the answer past the proxies' timeouts: the
  // administrator would see an error for an account that exists. A send
  // still running then goes on, and its failure is only logged.
  async function welcome({ userId, fields, preferredLocale }) {
    const sending = Promise.resolve()
      .then(() => sendWelcomeEmail({
        to: fields.email,
        firstname: fields.firstname,
        preferredLocale
      }))
      .then(
        () => 'sent',
        (error) => {
          logger.error('ADMIN CREATE ACCOUNT WELCOME EMAIL ERROR:', { userId, message: error?.message });
          return 'failed';
        }
      );
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve('timeout'), welcomeEmailTimeoutMs);
    });

    try {
      const outcome = await Promise.race([sending, timeout]);
      if (outcome === 'timeout') {
        logger.error('ADMIN CREATE ACCOUNT WELCOME EMAIL TIMEOUT:', { userId, timeoutMs: welcomeEmailTimeoutMs });
      }
      return outcome === 'sent';
    } finally {
      clearTimeout(timer);
    }
  }

  // POST /api/auth/admin/users
  // Body: { firstname, lastname, gender, email, role, preferred_locale,
  // password, password_confirmation }.
  // Answers 201 { id, message, welcome_email_sent }, or a refusal
  // { error, code } (see REFUSALS).
  router.post('/admin/users', async (req, res) => {
    if (!hasInternalServiceToken(req)) {
      return refuse(req, res, ERRORS.internalServiceTokenRequired);
    }

    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return refuse(req, res, ERRORS.unauthenticated);
    }

    if (!req.user || req.user.role !== 'S') {
      return refuse(req, res, ERRORS.unauthorized);
    }

    const body = req.body || {};
    const fields = readNewAccountFields(body);
    const role = readRole(body.role);
    const refusal = bodyRefusal(fields, role);

    if (refusal) {
      return refuse(req, res, refusal);
    }

    const preferredLocale = readPreferredLocale(req);
    let userId;

    try {
      const passwordHash = await hashPassword(fields.password);
      userId = await insertAccount({ fields, role, preferredLocale, passwordHash });
    } catch (error) {
      if (isUniqueMailViolation(error)) {
        return refuse(req, res, ERRORS.emailAlreadyRegistered);
      }

      logger.error('ADMIN CREATE ACCOUNT ERROR:', { message: error?.message });
      return res.status(500).json({
        error: t(req, 'internalServerError'),
        code: 'INTERNAL_ERROR'
      });
    }

    const welcomeEmailSent = await welcome({ userId, fields, preferredLocale });

    return res.status(201).json({
      id: userId,
      message: t(req, welcomeEmailSent ? 'accountCreatedByAdmin' : 'accountCreatedByAdminWelcomeEmailFailed'),
      welcome_email_sent: welcomeEmailSent
    });
  });

  return router;
}

export default createAdminUserAccountRouter();

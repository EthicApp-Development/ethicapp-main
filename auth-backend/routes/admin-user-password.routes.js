import express from 'express';

import { pool as defaultPool } from '../config/database.js';
import authMessages from '../i18n/messages/auth-messages.js';
import { translateMessage } from '../i18n/locale.js';
import { hasValidInternalServiceToken } from '../middleware/csrfProtection.js';
import { hashPassword as defaultHashPassword } from '../services/password.service.js';
import { isStrongPassword } from '../services/password-policy.js';

// An administrator sets the password of a student or teacher account (#889),
// typically during a pilot, to hand a temporary password to a user who
// cannot wait for the recovery email.
//
// Only management-console's backend calls this route, after its own step-up
// confirmation: it requires the internal service token as well as a role S
// session, and NGINX does not serve it at the edge.
//
// The password never leaves this module: it is not echoed in responses, and
// the queries run on a dedicated client, so the SQL error log of
// config/database.js never sees the hash either.

// Machine-readable refusal codes; management-console audits them and its
// frontend translates some of them, so they are part of the API contract.
export const ADMIN_SET_PASSWORD_ERRORS = Object.freeze({
  internalServiceTokenRequired: 'INTERNAL_SERVICE_TOKEN_REQUIRED',
  unauthenticated: 'UNAUTHENTICATED',
  unauthorized: 'UNAUTHORIZED',
  invalidUserId: 'INVALID_USER_ID',
  invalidExpectedEmail: 'INVALID_EXPECTED_EMAIL',
  requiredFieldsMissing: 'REQUIRED_FIELDS_MISSING',
  passwordsDoNotMatch: 'PASSWORDS_DO_NOT_MATCH',
  weakPassword: 'WEAK_PASSWORD',
  ownAccount: 'OWN_ACCOUNT',
  userNotFound: 'USER_NOT_FOUND',
  accountAnonymized: 'ACCOUNT_ANONYMIZED',
  roleNotAllowed: 'ROLE_NOT_ALLOWED',
  notLocalAccount: 'NOT_LOCAL_ACCOUNT',
  accountChanged: 'ACCOUNT_CHANGED'
});

const ERRORS = ADMIN_SET_PASSWORD_ERRORS;

// Status and message key of each refusal.
const REFUSALS = Object.freeze({
  [ERRORS.internalServiceTokenRequired]: { status: 403, messageKey: 'unauthorized' },
  [ERRORS.unauthenticated]: { status: 401, messageKey: 'unauthenticated' },
  [ERRORS.unauthorized]: { status: 403, messageKey: 'unauthorized' },
  [ERRORS.invalidUserId]: { status: 400, messageKey: 'invalidUserId' },
  [ERRORS.invalidExpectedEmail]: { status: 400, messageKey: 'requiredFieldsMissing' },
  [ERRORS.requiredFieldsMissing]: { status: 400, messageKey: 'requiredFieldsMissing' },
  [ERRORS.passwordsDoNotMatch]: { status: 400, messageKey: 'passwordsDoNotMatch' },
  [ERRORS.weakPassword]: { status: 400, messageKey: 'weakPassword' },
  [ERRORS.ownAccount]: { status: 409, messageKey: 'passwordSetOwnAccount' },
  [ERRORS.userNotFound]: { status: 404, messageKey: 'userNotFound' },
  [ERRORS.accountAnonymized]: { status: 409, messageKey: 'passwordSetAccountAnonymized' },
  [ERRORS.roleNotAllowed]: { status: 409, messageKey: 'passwordSetRoleNotAllowed' },
  [ERRORS.notLocalAccount]: { status: 409, messageKey: 'passwordSetNotLocalAccount' },
  [ERRORS.accountChanged]: { status: 409, messageKey: 'passwordSetAccountChanged' }
});

// Roles whose password an administrator may set: students and teachers.
const ROLES_ALLOWED = new Set(['A', 'P']);
const MAX_USER_ID = 2147483647;

function t(req, key) {
  return translateMessage(req, key, authMessages);
}

function refuse(req, res, code) {
  const { status, messageKey } = REFUSALS[code];
  return res.status(status).json({ error: t(req, messageKey), code });
}

function parseUserId(value) {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0 && userId <= MAX_USER_ID ? userId : null;
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// Whether the email the administrator approved is the account's email,
// ignoring case and surrounding spaces. A missing email never matches.
function isExpectedEmail(expectedEmail, storedEmail) {
  const expected = normalizeEmail(expectedEmail);
  return expected !== '' && expected === normalizeEmail(storedEmail);
}

// The refusal code for the locked account row, or null when the password
// may be set.
function refusalFor(user, expectedEmail) {
  if (user.anonymized_at) {
    return ERRORS.accountAnonymized;
  }
  if (!ROLES_ALLOWED.has(user.role)) {
    return ERRORS.roleNotAllowed;
  }
  if ((user.auth_provider || 'local') !== 'local') {
    return ERRORS.notLocalAccount;
  }
  if (!isExpectedEmail(expectedEmail, user.mail)) {
    return ERRORS.accountChanged;
  }
  return null;
}

export function createAdminUserPasswordRouter({
  pool = defaultPool,
  hashPassword = defaultHashPassword,
  hasInternalServiceToken = hasValidInternalServiceToken,
  logger = console
} = {}) {
  const router = express.Router();

  // Stores the new password in one transaction, under a lock on the user
  // row: checks the account, stores the hash, clears the legacy `pass`
  // column, increments session_version (every open session of the user
  // ends) and deletes the user's outstanding password-reset tokens. It does
  // not change `active` or `email_confirmed`.
  //
  // Resolves to null when the password was set, or to a refusal code.
  async function setPassword({ userId, passwordHash, expectedEmail }) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `
          SELECT id, mail, role, auth_provider, anonymized_at
          FROM users
          WHERE id = $1
          FOR UPDATE
        `,
        [userId]
      );

      if (userResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return ERRORS.userNotFound;
      }

      const user = userResult.rows[0];
      const refusal = refusalFor(user, expectedEmail);

      if (refusal) {
        await client.query('ROLLBACK');
        return refusal;
      }

      await client.query(
        `
          UPDATE users
          SET password_bcrypt = $1,
              pass = NULL,
              session_version = session_version + 1
          WHERE id = $2
        `,
        [passwordHash, userId]
      );

      await client.query(
        `
          DELETE FROM pass_reset
          WHERE lower(mail) = lower($1)
            AND token_purpose = 'password_reset'
        `,
        [user.mail]
      );

      await client.query('COMMIT');
      return null;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('ADMIN SET USER PASSWORD ROLLBACK ERROR:', { message: rollbackError?.message });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  // POST /api/auth/admin/users/:id/password
  // Body: { new_password, password_confirmation, expected_email }.
  // Answers 200 { message, id }, or a refusal { error, code } (see REFUSALS).
  router.post('/admin/users/:id/password', async (req, res) => {
    if (!hasInternalServiceToken(req)) {
      return refuse(req, res, ERRORS.internalServiceTokenRequired);
    }

    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return refuse(req, res, ERRORS.unauthenticated);
    }

    if (!req.user || req.user.role !== 'S') {
      return refuse(req, res, ERRORS.unauthorized);
    }

    const userId = parseUserId(req.params.id);
    if (!userId) {
      return refuse(req, res, ERRORS.invalidUserId);
    }

    const body = req.body || {};
    const newPassword = body.new_password;
    const passwordConfirmation = body.password_confirmation;
    const expectedEmail = body.expected_email ?? null;

    if (expectedEmail !== null && typeof expectedEmail !== 'string') {
      return refuse(req, res, ERRORS.invalidExpectedEmail);
    }

    if (
      typeof newPassword !== 'string' || newPassword === '' ||
      typeof passwordConfirmation !== 'string' || passwordConfirmation === ''
    ) {
      return refuse(req, res, ERRORS.requiredFieldsMissing);
    }

    if (newPassword !== passwordConfirmation) {
      return refuse(req, res, ERRORS.passwordsDoNotMatch);
    }

    if (!isStrongPassword(newPassword)) {
      return refuse(req, res, ERRORS.weakPassword);
    }

    // An administrator changes their own password from their profile, which
    // asks for the current one.
    if (Number(req.user.id) === userId) {
      return refuse(req, res, ERRORS.ownAccount);
    }

    try {
      // Hashed before the transaction, so the row lock is held briefly.
      const passwordHash = await hashPassword(newPassword);
      const refusal = await setPassword({ userId, passwordHash, expectedEmail });

      if (refusal) {
        return refuse(req, res, refusal);
      }

      return res.status(200).json({
        message: t(req, 'passwordSetByAdmin'),
        id: userId
      });
    } catch (error) {
      logger.error('ADMIN SET USER PASSWORD ERROR:', { userId, message: error?.message });
      return res.status(500).json({
        error: t(req, 'internalServerError'),
        code: 'INTERNAL_ERROR'
      });
    }
  });

  return router;
}

export default createAdminUserPasswordRouter();

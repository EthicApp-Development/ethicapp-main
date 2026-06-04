import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcrypt';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server';

import db from '../config/database.js';
import mailService from '../services/mail.service.js';
import recaptchaService from '../services/recaptcha.service.js';
import authMessages from '../i18n/messages/auth-messages.js';
import { inferPreferredLocaleFromRequest, normalizePreferredLocale, translateMessage } from '../i18n/locale.js';
import { csrfTokenHandler } from '../middleware/csrfProtection.js';
import { initializeSessionPolicy } from '../middleware/sessionPolicy.js';

const router = express.Router();

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
const RESET_TOKEN_TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60);
const PASSKEY_REGISTRATION_TIMEOUT_MS = Number(process.env.WEBAUTHN_REGISTRATION_TIMEOUT_MS || 60000);
const PASSKEY_AUTHENTICATION_TIMEOUT_MS = Number(process.env.WEBAUTHN_AUTHENTICATION_TIMEOUT_MS || 60000);

function isStrongPassword(password) {
  if (!password || password.length < 10) {
    return false;
  }

  const symbolCount = (password.match(/[^a-zA-Z0-9]/g) || []).length;
  return symbolCount >= 2;
}

function sha256Hex(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getPostLoginRedirect(role) {
  if (role === 'A') return '/student';
  if (role === 'P') return '/home';
  if (role === 'S') return '/mng';
  return '/login';
}

function isUniqueViolation(err) {
  return err && err.code === '23505';
}

function isUniqueMailViolation(err) {
  if (!isUniqueViolation(err)) {
    return false;
  }

  return (
    err.constraint === 'users_mail_key' ||
    err.constraint === 'users_mail_unique' ||
    (typeof err.detail === 'string' && err.detail.includes('(mail)='))
  );
}

function ensureAuthenticatedAdmin(req, res) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({
      error: t(req, 'unauthenticated')
    });
    return false;
  }

  if (!req.user || req.user.role !== 'S') {
    res.status(403).json({
      error: t(req, 'unauthorized')
    });
    return false;
  }

  return true;
}

function getRequestOrigin(req) {
  const configuredOrigin = (process.env.WEBAUTHN_ORIGIN || '').trim();

  if (configuredOrigin) {
    return configuredOrigin;
  }

  const requestOrigin = (req.get('Origin') || '').trim();

  if (requestOrigin) {
    return requestOrigin;
  }

  return `${req.protocol}://${req.get('host')}`;
}

function getWebAuthnRpId(req) {
  const configuredRpId = (process.env.WEBAUTHN_RP_ID || '').trim();

  if (configuredRpId) {
    return configuredRpId;
  }

  const origin = new URL(getRequestOrigin(req));
  return origin.hostname;
}

function getWebAuthnRpName() {
  return (process.env.WEBAUTHN_RP_NAME || 'EthicApp').trim();
}

function getUserDisplayName(user) {
  const displayName = [user.firstname, user.lastname].filter(Boolean).join(' ').trim();
  return displayName || user.mail;
}

function formatInstitutionContact(row) {
  if (!row) {
    return '';
  }

  const displayName = [row.firstname, row.lastname].filter(Boolean).join(' ').trim();
  const email = String(row.email || '').trim();

  if (displayName && email) {
    return `${displayName} <${email}>`;
  }

  return email || displayName;
}

function cleanPasskeyName(name) {
  const cleanName = String(name || '').trim();
  return cleanName ? cleanName.slice(0, 120) : null;
}

async function loadActiveUserForAdmin(userId) {
  const userResult = await db.query(
    `
      SELECT id, mail, password_bcrypt, firstname, lastname
      FROM users
      WHERE id = $1
        AND active = true
      LIMIT 1
    `,
    [userId]
  );

  return userResult.rowCount > 0 ? userResult.rows[0] : null;
}

async function verifyCurrentAdminPassword(req, res, password) {
  if (!password) {
    res.status(400).json({
      error: t(req, 'requiredFieldsMissing')
    });
    return null;
  }

  const user = await loadActiveUserForAdmin(req.user.id);

  if (!user) {
    res.status(401).json({
      error: t(req, 'wrongCredentials')
    });
    return null;
  }

  const validPassword = await bcrypt.compare(password, user.password_bcrypt || '');

  if (!validPassword) {
    res.status(401).json({
      error: t(req, 'wrongCredentials')
    });
    return null;
  }

  return user;
}

function mapPasskeyRow(row) {
  return {
    id: row.id,
    name: row.name || '',
    credential_device_type: row.credential_device_type || '',
    credential_backed_up: row.credential_backed_up === true,
    transports: Array.isArray(row.transports) ? row.transports : [],
    created_at: row.created_at,
    last_used_at: row.last_used_at
  };
}

async function listPasskeysForUser(userId) {
  const result = await db.query(
    `
      SELECT
        id,
        name,
        credential_device_type,
        credential_backed_up,
        transports,
        created_at,
        last_used_at
      FROM user_passkeys
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [userId]
  );

  return result.rows.map(mapPasskeyRow);
}

async function listPasskeyCredentialsForUser(userId) {
  const result = await db.query(
    `
      SELECT credential_id, transports
      FROM user_passkeys
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [userId]
  );

  return result.rows.map((passkey) => ({
    id: passkey.credential_id,
    transports: Array.isArray(passkey.transports) ? passkey.transports : undefined
  }));
}

function duplicateEmailResponse(req) {
  return {
    error: t(req, 'emailAlreadyRegistered'),
    code: 'email_already_registered',
    recovery_path: '/forgot'
  };
}

async function createSingleUseTokenForEmail(email, purpose = 'password_reset') {
  const rawToken = generateResetToken();
  const tokenDigest = sha256Hex(rawToken);

  await db.query(
    `
      DELETE FROM pass_reset
      WHERE lower(mail) = lower($1)
        AND token_purpose = $2
    `,
    [email, purpose]
  );
  await db.query(
    `
      INSERT INTO pass_reset (mail, token, ctime, token_purpose)
      VALUES ($1, $2, NOW(), $3)
    `,
    [email, tokenDigest, purpose]
  );

  return rawToken;
}



function t(req, key) {
  return translateMessage(req, key, authMessages);
}

router.get('/csrf-token', csrfTokenHandler);

router.get('/institution', async (req, res, next) => {
  try {
    const institutionResult = await db.query(
      `
        SELECT name
        FROM institution
        WHERE id = 1
        LIMIT 1
      `
    );

    const contactResult = await db.query(
      `
        SELECT firstname, lastname, email
        FROM institutional_contacts
        WHERE institution_id = 1
          AND contact_type = 'data_privacy'
        LIMIT 1
      `
    );

    return res.status(200).json({
      name: String(institutionResult.rows[0]?.name || '').trim(),
      privacyContact: formatInstitutionContact(contactResult.rows[0])
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    if (!username || !password) {
      return res.status(400).json({
        error: t(req, 'invalidCredentials')
      });
    }

    const userResult = await db.query(
      `
        SELECT
          id,
          rut,
          mail,
          role,
          auth_provider,
          active,
          email_confirmed,
          password_bcrypt,
          session_version
        FROM users
        WHERE active = true
          AND email_confirmed = true
          AND (lower(rut) = lower($1) OR lower(mail) = lower($1))
        LIMIT 1
      `,
      [username]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({
        error: t(req, 'wrongCredentials')
      });
    }

    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_bcrypt);

    if (!validPassword) {
      return res.status(401).json({
        error: t(req, 'wrongCredentials')
      });
    }

    await db.query(
      `
        UPDATE users
        SET last_login_at = NOW()
        WHERE id = $1
      `,
      [user.id]
    );

    req.login(
      {
        id: user.id,
        role: user.role,
        email: user.mail,
        auth_provider: user.auth_provider || 'local',
        sessionVersion: Number(user.session_version || 1),
        is_active: user.active && user.email_confirmed
      },
      function (err) {
        if (err) {
          return next(err);
        }

        initializeSessionPolicy(req, user.role, Date.now(), Number(user.session_version || 1));

        const redirectTo = getPostLoginRedirect(user.role);
        const sendLoginResponse = () => res.json({
          message: t(req, 'loginSuccess'),
          redirectTo
        });

        if (req.session && typeof req.session.save === 'function') {
          return req.session.save((saveError) => {
            if (saveError) {
              return next(saveError);
            }

            return sendLoginResponse();
          });
        }

        return sendLoginResponse();
      }
    );
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

router.post('/admin/verify-password', async (req, res) => {
  try {
    if (!ensureAuthenticatedAdmin(req, res)) {
      return undefined;
    }

    const password = req.body.password || '';

    const user = await verifyCurrentAdminPassword(req, res, password);
    if (!user) {
      return undefined;
    }

    return res.status(200).json({
      ok: true
    });
  } catch (err) {
    console.error('ADMIN VERIFY PASSWORD ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

router.post('/admin/change-password', async (req, res) => {
  try {
    if (!ensureAuthenticatedAdmin(req, res)) {
      return undefined;
    }

    const currentPassword = req.body.current_password || '';
    const newPassword = req.body.new_password || '';
    const passwordConfirmation = req.body.password_confirmation || '';

    if (!currentPassword || !newPassword || !passwordConfirmation) {
      return res.status(400).json({
        error: t(req, 'requiredFieldsMissing')
      });
    }

    if (newPassword !== passwordConfirmation) {
      return res.status(400).json({
        error: t(req, 'passwordsDoNotMatch')
      });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        error: t(req, 'weakPassword')
      });
    }

    const user = await verifyCurrentAdminPassword(req, res, currentPassword);
    if (!user) {
      return undefined;
    }

    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await db.query(
      `
        UPDATE users
        SET password_bcrypt = $1,
            session_version = session_version + 1
        WHERE id = $2
      `,
      [newPasswordHash, req.user.id]
    );

    return res.status(200).json({
      message: t(req, 'passwordUpdated')
    });
  } catch (err) {
    console.error('ADMIN CHANGE PASSWORD ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

router.post('/admin/password-reset', async (req, res) => {
  try {
    if (!ensureAuthenticatedAdmin(req, res)) {
      return undefined;
    }

    const email = (req.body.email || '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        error: t(req, 'emailRequired')
      });
    }

    const rawToken = await createSingleUseTokenForEmail(email);
    const preferredLocale = normalizePreferredLocale(req.body.preferred_locale || inferPreferredLocaleFromRequest(req));

    await mailService.sendPasswordResetEmail({
      to: email,
      rawToken,
      preferredLocale
    });

    return res.status(200).json({
      message: t(req, 'forgotSuccess')
    });
  } catch (err) {
    console.error('ADMIN PASSWORD RESET ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

router.get('/admin/passkeys', async (req, res) => {
  try {
    if (!ensureAuthenticatedAdmin(req, res)) {
      return undefined;
    }

    const passkeys = await listPasskeysForUser(req.user.id);

    return res.status(200).json({ passkeys });
  } catch (err) {
    console.error('ADMIN LIST PASSKEYS ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

router.post('/admin/passkeys/registration-options', async (req, res) => {
  try {
    if (!ensureAuthenticatedAdmin(req, res)) {
      return undefined;
    }

    const password = req.body.password || '';
    const user = await verifyCurrentAdminPassword(req, res, password);

    if (!user) {
      return undefined;
    }

    const existingPasskeysResult = await db.query(
      `
        SELECT credential_id, transports
        FROM user_passkeys
        WHERE user_id = $1
      `,
      [req.user.id]
    );

    const options = await generateRegistrationOptions({
      rpName: getWebAuthnRpName(),
      rpID: getWebAuthnRpId(req),
      userID: new TextEncoder().encode(String(user.id)),
      userName: user.mail,
      userDisplayName: getUserDisplayName(user),
      timeout: PASSKEY_REGISTRATION_TIMEOUT_MS,
      attestationType: 'none',
      excludeCredentials: existingPasskeysResult.rows.map((passkey) => ({
        id: passkey.credential_id,
        transports: Array.isArray(passkey.transports) ? passkey.transports : undefined
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred'
      }
    });

    req.session.passkeyRegistration = {
      challenge: options.challenge,
      userId: req.user.id,
      rpId: getWebAuthnRpId(req),
      origin: getRequestOrigin(req)
    };

    return res.status(200).json(options);
  } catch (err) {
    console.error('ADMIN PASSKEY REGISTRATION OPTIONS ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

router.post('/admin/passkeys/register', async (req, res) => {
  try {
    if (!ensureAuthenticatedAdmin(req, res)) {
      return undefined;
    }

    const registrationState = req.session.passkeyRegistration;

    if (!registrationState || registrationState.userId !== req.user.id) {
      return res.status(400).json({
        error: t(req, 'passkeyRegistrationExpired')
      });
    }

    const verification = await verifyRegistrationResponse({
      response: req.body.credential,
      expectedChallenge: registrationState.challenge,
      expectedOrigin: registrationState.origin,
      expectedRPID: registrationState.rpId,
      requireUserVerification: false
    });

    if (!verification.verified || !verification.registrationInfo) {
      delete req.session.passkeyRegistration;
      return res.status(400).json({
        error: t(req, 'passkeyRegistrationFailed')
      });
    }

    const {
      credential,
      credentialDeviceType,
      credentialBackedUp
    } = verification.registrationInfo;

    await db.query(
      `
        INSERT INTO user_passkeys (
          user_id,
          credential_id,
          credential_public_key,
          counter,
          credential_device_type,
          credential_backed_up,
          transports,
          name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        req.user.id,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        credentialDeviceType,
        credentialBackedUp,
        credential.transports || [],
        cleanPasskeyName(req.body.name)
      ]
    );

    delete req.session.passkeyRegistration;

    const passkeys = await listPasskeysForUser(req.user.id);

    return res.status(201).json({
      message: t(req, 'passkeyRegistered'),
      passkeys
    });
  } catch (err) {
    delete req.session.passkeyRegistration;

    if (isUniqueViolation(err)) {
      return res.status(409).json({
        error: t(req, 'passkeyAlreadyRegistered')
      });
    }

    console.error('ADMIN PASSKEY REGISTER ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

router.post('/admin/passkeys/authentication-options', async (req, res) => {
  try {
    if (!ensureAuthenticatedAdmin(req, res)) {
      return undefined;
    }

    const allowCredentials = await listPasskeyCredentialsForUser(req.user.id);

    if (allowCredentials.length === 0) {
      return res.status(409).json({
        error: t(req, 'passkeyNotConfigured')
      });
    }

    const options = await generateAuthenticationOptions({
      rpID: getWebAuthnRpId(req),
      allowCredentials,
      timeout: PASSKEY_AUTHENTICATION_TIMEOUT_MS,
      userVerification: 'preferred'
    });

    req.session.passkeyAuthentication = {
      challenge: options.challenge,
      userId: req.user.id,
      rpId: getWebAuthnRpId(req),
      origin: getRequestOrigin(req)
    };

    return res.status(200).json(options);
  } catch (err) {
    console.error('ADMIN PASSKEY AUTHENTICATION OPTIONS ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

router.post('/admin/passkeys/verify', async (req, res) => {
  try {
    if (!ensureAuthenticatedAdmin(req, res)) {
      return undefined;
    }

    const authenticationState = req.session.passkeyAuthentication;

    if (!authenticationState || authenticationState.userId !== req.user.id) {
      return res.status(400).json({
        error: t(req, 'passkeyAuthenticationExpired')
      });
    }

    const assertion = req.body.assertion;

    if (!assertion || !assertion.id) {
      return res.status(400).json({
        error: t(req, 'requiredFieldsMissing')
      });
    }

    const passkeyResult = await db.query(
      `
        SELECT credential_id, credential_public_key, counter, transports
        FROM user_passkeys
        WHERE user_id = $1
          AND credential_id = $2
        LIMIT 1
      `,
      [req.user.id, assertion.id]
    );

    if (passkeyResult.rowCount === 0) {
      delete req.session.passkeyAuthentication;
      return res.status(401).json({
        error: t(req, 'passkeyAuthenticationFailed')
      });
    }

    const passkey = passkeyResult.rows[0];
    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: authenticationState.challenge,
      expectedOrigin: authenticationState.origin,
      expectedRPID: authenticationState.rpId,
      credential: {
        id: passkey.credential_id,
        publicKey: new Uint8Array(passkey.credential_public_key),
        counter: Number(passkey.counter || 0),
        transports: Array.isArray(passkey.transports) ? passkey.transports : undefined
      },
      requireUserVerification: false
    });

    if (!verification.verified) {
      delete req.session.passkeyAuthentication;
      return res.status(401).json({
        error: t(req, 'passkeyAuthenticationFailed')
      });
    }

    await db.query(
      `
        UPDATE user_passkeys
        SET counter = $1,
            last_used_at = NOW()
        WHERE user_id = $2
          AND credential_id = $3
      `,
      [
        verification.authenticationInfo.newCounter,
        req.user.id,
        verification.authenticationInfo.credentialID
      ]
    );

    delete req.session.passkeyAuthentication;

    return res.status(200).json({
      ok: true
    });
  } catch (err) {
    delete req.session.passkeyAuthentication;
    console.error('ADMIN PASSKEY VERIFY ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

router.delete('/admin/passkeys/:passkeyId', async (req, res) => {
  try {
    if (!ensureAuthenticatedAdmin(req, res)) {
      return undefined;
    }

    const password = req.body.password || '';
    const user = await verifyCurrentAdminPassword(req, res, password);

    if (!user) {
      return undefined;
    }

    const passkeyId = Number(req.params.passkeyId);

    if (!Number.isInteger(passkeyId) || passkeyId <= 0) {
      return res.status(400).json({
        error: t(req, 'requiredFieldsMissing')
      });
    }

    await db.query(
      `
        DELETE FROM user_passkeys
        WHERE id = $1
          AND user_id = $2
      `,
      [passkeyId, req.user.id]
    );

    const passkeys = await listPasskeysForUser(req.user.id);

    return res.status(200).json({
      message: t(req, 'passkeyDeleted'),
      passkeys
    });
  } catch (err) {
    console.error('ADMIN PASSKEY DELETE ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

/**
 * POST /register
 *
 * Expects:
 * {
 *   name,
 *   lastname,
 *   dni,
 *   gender,
 *   email,
 *   password,
 *   password_confirmation
 * }
 */
router.post('/register', async (req, res) => {
  try {
    const firstname = (req.body.firstname || '').trim();
    const name = (req.body.name || '').trim();
    const lastname = (req.body.lastname || '').trim();
    const dni = (req.body.dni || '').trim();
    const gender = (req.body.gender || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const passwordConfirmation = req.body.password_confirmation || '';
    const recaptchaToken = (req.body.recaptcha_token || '').trim();
    const preferredLocale = normalizePreferredLocale((req.body.preferred_locale || '').trim() || inferPreferredLocaleFromRequest(req));

    if (!firstname || !lastname || !dni || !email || !gender || !password || !passwordConfirmation) {
      return res.status(400).json({
        error: t(req, 'requiredFieldsMissing')
      });
    }

    const isHuman = await recaptchaService.verifyRecaptchaToken({
      token: recaptchaToken,
      remoteIp: req.ip
    });

    if (!isHuman) {
      return res.status(400).json({
        error: t(req, 'invalidRecaptcha')
      });
    }

    if (password !== passwordConfirmation) {

      return res.status(400).json({
        error: t(req, 'passwordsDoNotMatch')
      });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: t(req, 'weakPassword')
      });
    }

    if (!['F', 'M', 'O'].includes(gender)) {
      return res.status(400).json({
        error: t(req, 'invalidGender')
      });
    }


    const existingUserResult = await db.query(
      `
        SELECT id, mail, rut
        FROM users
        WHERE rut = $1
           OR mail = $2
        ORDER BY (mail = $2) DESC
        LIMIT 1
      `,
      [dni, email]
    );

    if (existingUserResult.rowCount > 0) {
      if (existingUserResult.rows[0].mail === email) {
        return res.status(409).json(duplicateEmailResponse(req));
      }

      return res.status(409).json({
        code: 'duplicate_user_identifier',
        error: t(req, 'duplicateUserIdentifier')
      });
    }

    const passwordBcrypt = await bcrypt.hash(password, SALT_ROUNDS);

    const fullName = [firstname, lastname].filter(Boolean).join(' ').trim();

    await db.query('BEGIN');

    let insertResult;
    let rawConfirmationToken;

    try {
      insertResult = await db.query(
        `
            INSERT INTO users
            (firstname, lastname, name, rut, sex, mail, role, preferred_locale, password_bcrypt, auth_provider, active, email_confirmed)
            VALUES
            ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, $9, $10, false, false)
            RETURNING id
        `,
        [firstname, lastname, fullName, dni, gender, email, 'A', preferredLocale, passwordBcrypt, 'local']
        );

      rawConfirmationToken = await createSingleUseTokenForEmail(email, 'account_confirmation');
      await db.query('COMMIT');
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }

    try {
      await mailService.sendAccountConfirmationEmail({
        to: email,
        rawToken: rawConfirmationToken,
        preferredLocale
      });
    } catch (mailErr) {
      console.error('ACCOUNT CONFIRMATION EMAIL ERROR:', mailErr);

      return res.status(201).json({
        message: t(req, 'userCreatedConfirmationEmailFailed'),
        code: 'confirmation_email_failed',
        user_id: insertResult.rows[0].id
      });
    }

    return res.status(201).json({
      message: t(req, 'userCreated'),
      user_id: insertResult.rows[0].id
    });
  } catch (err) {
    console.error('REGISTER ERROR:', err);

    if (isUniqueMailViolation(err)) {
      return res.status(409).json(duplicateEmailResponse(req));
    }

    if (isUniqueViolation(err)) {
      return res.status(409).json({
        code: 'duplicate_user_identifier',
        error: t(req, 'duplicateUserIdentifier')
      });
    }

    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

router.get(['/confirm-account', '/confirm-account/:token'], async (req, res) => {
  try {
    const token = (req.params.token || req.query.token || '').trim();

    if (!token) {
      return res.redirect('/auth/login?confirmed=invalid');
    }

    const tokenDigest = sha256Hex(token);

    const confirmationResult = await db.query(
      `
        SELECT pr.mail, u.email_confirmed
        FROM pass_reset pr
        INNER JOIN users u ON lower(u.mail) = lower(pr.mail)
        WHERE pr.token = $1
          AND pr.token_purpose = 'account_confirmation'
          AND pr.ctime > NOW() - ($2 * INTERVAL '1 minute')
        LIMIT 1
      `,
      [tokenDigest, RESET_TOKEN_TTL_MINUTES]
    );

    if (confirmationResult.rowCount === 0) {
      return res.redirect('/auth/login?confirmed=invalid');
    }

    const confirmationRequest = confirmationResult.rows[0];
    const email = confirmationRequest.mail;

    if (confirmationRequest.email_confirmed === true) {
      return res.redirect('/auth/login?confirmed=1');
    }

    await db.query('BEGIN');

    try {
      await db.query(
        `
          UPDATE users
          SET active = true,
              email_confirmed = true
          WHERE lower(mail) = lower($1)
        `,
        [email]
      );

      await db.query('COMMIT');
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }

    return res.redirect('/auth/login?confirmed=1');
  } catch (err) {
    console.error('CONFIRM ACCOUNT ERROR:', err);
    return res.redirect('/auth/login?confirmed=error');
  }
});

/**
 * POST /register-prof
 *
 * Admin-only endpoint to create a professor account.
 *
 * Expects:
 * {
 *   firstname,
 *   lastname,
 *   dni,
 *   gender,
 *   email,
 *   password,
 *   password_confirmation
 * }
 *
 * Legacy rule preserved:
 * - only role "S" can create professors
 * - created user gets role "P"
 */
router.post('/register-prof', async (req, res) => {
  try {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({
        error: t(req, 'unauthenticated')
      });
    }

    if (!req.user || req.user.role !== 'S') {
      return res.status(403).json({
        error: t(req, 'unauthorized')
      });
    }

    // Compatibilidad legacy:
    // - name = firstname
    // - lastname se mantiene
    const firstname = (req.body.firstname || req.body.name || '').trim();
    const lastname = (req.body.lastname || '').trim();

    const dni = (req.body.dni || '').trim();
    const gender = (req.body.gender || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const passwordConfirmation = req.body.password_confirmation || '';

    if (!firstname || !lastname || !dni || !gender || !password || !passwordConfirmation) {
      return respondRegisterProfError(req, res, 400, t(req, 'requiredFieldsMissing'));
    }

    if (password !== passwordConfirmation) {
      return respondRegisterProfError(req, res, 400, t(req, 'passwordsDoNotMatch'));
    }

    if (!isStrongPassword(password)) {
      return respondRegisterProfError(
        req,
        res,
        400,
        t(req, 'weakPassword')
      );
    }

    if (!['F', 'M', 'O'].includes(gender)) {
      return respondRegisterProfError(req, res, 400, t(req, 'invalidGender'));
    }

    const existingUserResult = await db.query(
      `
        SELECT id
        FROM users
        WHERE rut = $1
           OR ($2 <> '' AND mail = $2)
        LIMIT 1
      `,
      [dni, email]
    );

    if (existingUserResult.rowCount > 0) {
      return respondRegisterProfError(
        req,
        res,
        409,
        t(req, 'duplicateUserIdentifier')
      );
    }

    const passwordBcrypt = await bcrypt.hash(password, SALT_ROUNDS);
    const fullName = [firstname, lastname].filter(Boolean).join(' ').trim();

    const insertResult = await db.query(
      `
        INSERT INTO users
          (firstname, lastname, name, rut, sex, mail, role, password_bcrypt, auth_provider, active)
        VALUES
          ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, $9, true)
        RETURNING id
      `,
      [firstname, lastname, fullName, dni, gender, email, 'P', passwordBcrypt, 'local']
    );

    if (wantsHtmlRedirect(req)) {
      return res.redirect('/login?rc=1');
    }

    return res.status(201).json({
      message: t(req, 'professorCreated'),
      user_id: insertResult.rows[0].id
    });
  } catch (err) {
    console.error('REGISTER PROF ERROR:', err);

    if (err.code === '23505') {
      return respondRegisterProfError(
        req,
        res,
        409,
        t(req, 'duplicateUserIdentifier')
      );
    }

    return respondRegisterProfError(
      req,
      res,
      500,
      t(req, 'internalServerError')
    );
  }
});

function wantsHtmlRedirect(req) {
  const accept = req.headers.accept || '';
  return accept.includes('text/html');
}

function respondRegisterProfError(req, res, statusCode, message) {
  if (wantsHtmlRedirect(req)) {
    return res.status(statusCode).send(message);
  }

  return res.status(statusCode).json({
    error: message
  });
}

/**
 * GET /auth/session
 *
 * Used by EthicApp legacy to bootstrap or refresh its own local session.
 */
router.get('/auth/session', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      error: t(req, 'unauthenticated')
    });
  }

  return res.json({
    user_id: req.session.user.id,
    role: req.session.user.role,
    provider: req.session.user.provider
  });
});

function clearAuthCookie(res) {
  res.clearCookie(process.env.SESSION_COOKIE_NAME || 'auth.sid', {
    path: '/'
  });
}

function handleLogout(req, res) {
  const finish = () => {
    clearAuthCookie(res);

    if (req.method === 'GET') {
      return res.redirect(302, '/login');
    }

    return res.json({ message: t(req, 'sessionClosed') });
  };

  if (!req.session) {
    return finish();
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('LOGOUT ERROR:', err);

      if (req.method === 'GET') {
        clearAuthCookie(res);
        return res.redirect(302, '/login');
      }

      return res.status(500).json({ error: t(req, 'logoutError') });
    }

    return finish();
  });
}

/**
 * GET, POST /logout
 */
router.get('/logout', handleLogout);
router.post('/logout', handleLogout);

/**
 * POST /forgot
 *
 * Expects:
 * {
 *   email
 * }
 *
 * This implementation stores a reset token digest and expiry in the users table
 * and then sends an email with the reset link.
 */
router.post('/forgot', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const recaptchaToken = (req.body.recaptcha_token || '').trim();
    const preferredLocale = inferPreferredLocaleFromRequest(req);

    if (!email) {
      return res.status(400).json({
        error: t(req, 'emailRequired')
      });
    }

    const isHuman = await recaptchaService.verifyRecaptchaToken({
      token: recaptchaToken,
      remoteIp: req.ip
    });

    if (!isHuman) {
      return res.status(400).json({
        error: t(req, 'invalidRecaptcha')
      });
    }

    const userResult = await db.query(
      `
        SELECT id, mail, active, email_confirmed
        FROM users
        WHERE lower(mail) = $1
          AND (active = true OR email_confirmed = false)
        LIMIT 1
      `,
      [email]
    );

    // Always return the same message to avoid account enumeration.
    const genericResponse = {
      message: t(req, 'forgotSuccess')
    };

    if (userResult.rowCount === 0) {
      return res.json(genericResponse);
    }

    const user = userResult.rows[0];
    await db.query('BEGIN');

    let rawToken;

    try {
      rawToken = await createSingleUseTokenForEmail(user.mail, 'password_reset');
      await db.query('COMMIT');
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }

    await mailService.sendPasswordResetEmail({
      to: user.mail,
      rawToken,
      preferredLocale
    });

    return res.json(genericResponse);
  } catch (err) {
    console.error('FORGOT PASSWORD ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

/**
 * POST /reset-password
 *
 * Expects:
 * {
 *   token,
 *   password,
 *   password_confirmation
 * }
 */
router.post('/reset-password', async (req, res) => {
  try {
    const token = (req.body.token || '').trim();
    const password = req.body.password || '';
    const passwordConfirmation = req.body.password_confirmation || '';

    if (!token || !password || !passwordConfirmation) {
      return res.status(400).json({
        error: t(req, 'requiredFieldsMissing')
      });
    }

    if (password !== passwordConfirmation) {
      return res.status(400).json({
        error: t(req, 'passwordsDoNotMatch')
      });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: t(req, 'weakPassword')
      });
    }

    const tokenDigest = sha256Hex(token);

    const resetResult = await db.query(
      `
        SELECT mail
        FROM pass_reset
        WHERE token = $1
          AND token_purpose = 'password_reset'
          AND ctime > NOW() - ($2 * INTERVAL '1 minute')
        LIMIT 1
      `,
      [tokenDigest, RESET_TOKEN_TTL_MINUTES]
    );

    if (resetResult.rowCount === 0) {
      return res.status(400).json({
        error: t(req, 'invalidOrExpiredToken')
      });
    }

    const resetRequest = resetResult.rows[0];

    const userResult = await db.query(
      `
        SELECT id, active, email_confirmed
        FROM users
        WHERE lower(mail) = lower($1)
          AND (active = true OR email_confirmed = false)
        LIMIT 1
      `,
      [resetRequest.mail]
    );

    if (userResult.rowCount === 0) {
      return res.status(400).json({
        error: t(req, 'invalidOrExpiredToken')
      });
    }

    const user = userResult.rows[0];
    const passwordBcrypt = await bcrypt.hash(password, SALT_ROUNDS);

    await db.query('BEGIN');

    try {
      await db.query(
        `
          UPDATE users
          SET password_bcrypt = $1,
              active = CASE WHEN email_confirmed = false THEN true ELSE active END,
              email_confirmed = true,
              session_version = session_version + 1
          WHERE id = $2
        `,
        [passwordBcrypt, user.id]
      );

      await db.query(
        `
          DELETE FROM pass_reset
          WHERE lower(mail) = lower($1)
            AND token_purpose = 'password_reset'
        `,
        [resetRequest.mail]
      );

      await db.query('COMMIT');
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }

    return res.json({
      message: t(req, 'passwordUpdated')
    });
  } catch (err) {
    console.error('RESET PASSWORD ERROR:', err);
    return res.status(500).json({
      error: t(req, 'internalServerError')
    });
  }
});

export default router;

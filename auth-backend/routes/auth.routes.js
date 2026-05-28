import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcrypt';

import db from '../config/database.js';
import mailService from '../services/mail.service.js';
import recaptchaService from '../services/recaptcha.service.js';
import authMessages from '../i18n/messages/auth-messages.js';
import { inferPreferredLocaleFromRequest, normalizePreferredLocale, translateMessage } from '../i18n/locale.js';
import { csrfTokenHandler } from '../middleware/csrfProtection.js';

const router = express.Router();

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
const RESET_TOKEN_TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60);

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
          password_bcrypt
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

    req.login(
      {
        id: user.id,
        role: user.role,
        email: user.mail,
        auth_provider: user.auth_provider || 'local',
        is_active: user.active && user.email_confirmed
      },
      function (err) {
        if (err) {
          return next(err);
        }

        const redirectTo = getPostLoginRedirect(user.role);

        return res.json({
          message: t(req, 'loginSuccess'),
          redirectTo
        });
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

    const password = req.body.password || '';

    if (!password) {
      return res.status(400).json({
        error: t(req, 'requiredFieldsMissing')
      });
    }

    const userResult = await db.query(
      `
        SELECT password_bcrypt
        FROM users
        WHERE id = $1
          AND active = true
        LIMIT 1
      `,
      [req.user.id]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({
        error: t(req, 'wrongCredentials')
      });
    }

    const validPassword = await bcrypt.compare(password, userResult.rows[0].password_bcrypt || '');

    if (!validPassword) {
      return res.status(401).json({
        error: t(req, 'wrongCredentials')
      });
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

    const userResult = await db.query(
      `
        SELECT password_bcrypt
        FROM users
        WHERE id = $1
          AND active = true
        LIMIT 1
      `,
      [req.user.id]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({
        error: t(req, 'wrongCredentials')
      });
    }

    const currentPasswordValid = await bcrypt.compare(
      currentPassword,
      userResult.rows[0].password_bcrypt || ''
    );

    if (!currentPasswordValid) {
      return res.status(401).json({
        error: t(req, 'wrongCredentials')
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await db.query(
      `
        UPDATE users
        SET password_bcrypt = $1
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
              email_confirmed = true
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

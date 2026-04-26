const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const db = require('../config/database');
const mailService = require('../services/mail.service');
const recaptchaService = require('../services/recaptcha.service');

const router = express.Router();

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'connect.sid';
const RESET_TOKEN_TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60);
const DEFAULT_LOCALE = 'en_US';

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

function getResetTokenExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + RESET_TOKEN_TTL_MINUTES);
  return expiresAt;
}

function getPostLoginRedirect(role) {
  if (role === 'A') return '/student';
  if (role === 'P') return '/home';
  if (role === 'S') return '/super';
  return '/login';
}



function normalizePreferredLocale(locale) {
  const normalizedLocale = String(locale || '').trim().toLowerCase().replace('-', '_');

  if (normalizedLocale.startsWith('es_') || normalizedLocale === 'es') {
    return 'es_CL';
  }

  return 'en_US';
}

function inferPreferredLocaleFromRequest(req) {
  const bodyLocale = (req.body?.preferred_locale || '').trim();

  if (bodyLocale) {
    return normalizePreferredLocale(bodyLocale);
  }

  const acceptLanguageHeader = String(req.headers['accept-language'] || '');
  const languageCandidates = acceptLanguageHeader
    .split(',')
    .map((entry) => entry.split(';')[0].trim())
    .filter(Boolean);

  return normalizePreferredLocale(languageCandidates[0] || DEFAULT_LOCALE);
}

router.post('/login', async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    if (!username || !password) {
      return res.status(400).json({
        error: 'Credenciales inválidas'
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
          password_bcrypt
        FROM users
        WHERE active = true
          AND (rut = $1 OR mail = $1)
        LIMIT 1
      `,
      [username]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({
        error: 'Credenciales incorrectas'
      });
    }

    const user = userResult.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_bcrypt);

    if (!validPassword) {
      return res.status(401).json({
        error: 'Credenciales incorrectas'
      });
    }

    req.login(
      {
        id: user.id,
        role: user.role,
        email: user.mail,
        auth_provider: user.auth_provider || 'local',
        is_active: user.active
      },
      function (err) {
        if (err) {
          return next(err);
        }

        const redirectTo = getPostLoginRedirect(user.role);

        return res.json({
          message: 'Login exitoso',
          redirectTo
        });
      }
    );
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return res.status(500).json({
      error: 'Error interno del servidor'
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
 *   email,                  // optional, but recommended
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

    if (!firstname || !lastname || !dni || !gender || !password || !passwordConfirmation) {
      return res.status(400).json({
        error: 'Faltan campos obligatorios'
      });
    }

    const isHuman = await recaptchaService.verifyRecaptchaToken({
      token: recaptchaToken,
      remoteIp: req.ip
    });

    if (!isHuman) {
      return res.status(400).json({
        error: 'Validación reCAPTCHA inválida'
      });
    }

    if (password !== passwordConfirmation) {

      return res.status(400).json({
        error: 'Las contraseñas no coinciden'
      });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 10 caracteres y al menos 2 símbolos'
      });
    }

    if (!['F', 'M', 'O'].includes(gender)) {
      return res.status(400).json({
        error: 'Género inválido'
      });
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
      return res.status(409).json({
        error: 'Ya existe un usuario con ese identificador'
      });
    }

    const passwordBcrypt = await bcrypt.hash(password, SALT_ROUNDS);

    const fullName = [firstname, lastname].filter(Boolean).join(' ').trim();

    const insertResult = await db.query(
        `
            INSERT INTO users
            (firstname, lastname, name, rut, sex, mail, role, preferred_locale, password_bcrypt, auth_provider, active)
            VALUES
            ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, $9, $10, true)
            RETURNING id
        `,
        [firstname, lastname, fullName, dni, gender, email, 'A', preferredLocale, passwordBcrypt, 'local']
        );

    return res.status(201).json({
      message: 'Usuario creado correctamente',
      user_id: insertResult.rows[0].id
    });
  } catch (err) {
    console.error('REGISTER ERROR:', err);

    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Ya existe un usuario con ese identificador'
      });
    }

    return res.status(500).json({
      error: 'Error interno del servidor'
    });
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
        error: 'No autenticado'
      });
    }

    if (!req.user || req.user.role !== 'S') {
      return res.status(403).json({
        error: 'No autorizado'
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
      return respondRegisterProfError(req, res, 400, 'Faltan campos obligatorios');
    }

    if (password !== passwordConfirmation) {
      return respondRegisterProfError(req, res, 400, 'Las contraseñas no coinciden');
    }

    if (!isStrongPassword(password)) {
      return respondRegisterProfError(
        req,
        res,
        400,
        'La contraseña debe tener al menos 10 caracteres y al menos 2 símbolos'
      );
    }

    if (!['F', 'M', 'O'].includes(gender)) {
      return respondRegisterProfError(req, res, 400, 'Género inválido');
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
        'Ya existe un usuario con ese identificador'
      );
    }

    const passwordBcrypt = await bcrypt.hash(password, SALT_ROUNDS);
    const fullName = [firstname, lastname].filter(Boolean).join(' ').trim();

    const insertResult = await db.query(
      `
        INSERT INTO users
          (firstname, lastname, name, rut, sex, mail, role, password_bcrypt, auth_provider, active)
        VALUES
          ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8, true)
        RETURNING id
      `,
      [firstname, lastname, fullName, dni, gender, email, 'P', passwordBcrypt, 'local']
    );

    if (wantsHtmlRedirect(req)) {
      return res.redirect('/login?rc=1');
    }

    return res.status(201).json({
      message: 'Profesor creado correctamente',
      user_id: insertResult.rows[0].id
    });
  } catch (err) {
    console.error('REGISTER PROF ERROR:', err);

    if (err.code === '23505') {
      return respondRegisterProfError(
        req,
        res,
        409,
        'Ya existe un usuario con ese identificador'
      );
    }

    return respondRegisterProfError(
      req,
      res,
      500,
      'Error interno del servidor'
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
      error: 'No autenticado'
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

    return res.json({ message: 'Sesión cerrada' });
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

      return res.status(500).json({ error: 'Error al cerrar sesión' });
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
        error: 'El correo es obligatorio'
      });
    }

    const isHuman = await recaptchaService.verifyRecaptchaToken({
      token: recaptchaToken,
      remoteIp: req.ip
    });

    if (!isHuman) {
      return res.status(400).json({
        error: 'Validación reCAPTCHA inválida'
      });
    }

    const userResult = await db.query(
      `
        SELECT id, mail, active
        FROM users
        WHERE lower(mail) = $1
          AND active = true
        LIMIT 1
      `,
      [email]
    );

    // Always return the same message to avoid account enumeration.
    const genericResponse = {
      message: 'Si el correo existe, recibirás instrucciones para restablecer la contraseña'
    };

    if (userResult.rowCount === 0) {
      return res.json(genericResponse);
    }

    const user = userResult.rows[0];
    const rawToken = generateResetToken();
    const tokenDigest = sha256Hex(rawToken);

    await db.query('BEGIN');

    try {
      await db.query(`DELETE FROM pass_reset WHERE mail = $1`, [user.mail]);
      await db.query(
        `
          INSERT INTO pass_reset (mail, token, ctime)
          VALUES ($1, $2, NOW())
        `,
        [user.mail, tokenDigest]
      );
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
      error: 'Error interno del servidor'
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
        error: 'Faltan campos obligatorios'
      });
    }

    if (password !== passwordConfirmation) {
      return res.status(400).json({
        error: 'Las contraseñas no coinciden'
      });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 10 caracteres y al menos 2 símbolos'
      });
    }

    const tokenDigest = sha256Hex(token);

    const resetResult = await db.query(
      `
        SELECT mail
        FROM pass_reset
        WHERE token = $1
          AND ctime > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `,
      [tokenDigest]
    );

    if (resetResult.rowCount === 0) {
      return res.status(400).json({
        error: 'El token es inválido o ha expirado'
      });
    }

    const resetRequest = resetResult.rows[0];

    const userResult = await db.query(
      `
        SELECT id
        FROM users
        WHERE lower(mail) = lower($1)
          AND active = true
        LIMIT 1
      `,
      [resetRequest.mail]
    );

    if (userResult.rowCount === 0) {
      return res.status(400).json({
        error: 'El token es inválido o ha expirado'
      });
    }

    const user = userResult.rows[0];
    const passwordBcrypt = await bcrypt.hash(password, SALT_ROUNDS);

    await db.query('BEGIN');

    try {
      await db.query(
        `
          UPDATE users
          SET password_bcrypt = $1
          WHERE id = $2
        `,
        [passwordBcrypt, user.id]
      );

      await db.query(
        `
          DELETE FROM pass_reset
          WHERE mail = $1
        `,
        [resetRequest.mail]
      );

      await db.query('COMMIT');
    } catch (txErr) {
      await db.query('ROLLBACK');
      throw txErr;
    }

    return res.json({
      message: 'Contraseña actualizada correctamente'
    });
  } catch (err) {
    console.error('RESET PASSWORD ERROR:', err);
    return res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

module.exports = router;
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const db = require('../config/database');
const mailService = require('../services/mail.service');

const router = express.Router();

const SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'connect.sid';
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

function getResetTokenExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + RESET_TOKEN_TTL_MINUTES);
  return expiresAt;
}

function getPostLoginRedirect(role) {
  if (role === 'A') return '/seslist';
  if (role === 'P') return '/admin';
  if (role === 'S') return '/super';
  return '/login';
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
    const name = (req.body.name || '').trim();
    const lastname = (req.body.lastname || '').trim();
    const dni = (req.body.dni || '').trim();
    const gender = (req.body.gender || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const passwordConfirmation = req.body.password_confirmation || '';

    if (!name || !lastname || !dni || !gender || !password || !passwordConfirmation) {
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

    const insertResult = await db.query(
      `
        INSERT INTO users
          (name, lastname, rut, gender, mail, role, password_bcrypt, auth_provider, active)
        VALUES
          ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, true)
        RETURNING id
      `,
      [name, lastname, dni, gender, email, 'A', passwordBcrypt, 'local']
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

/**
 * POST /logout
 */
router.post('/logout', (req, res) => {
  if (!req.session) {
    res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
    return res.json({
      message: 'Sesión cerrada'
    });
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('LOGOUT ERROR:', err);
      return res.status(500).json({
        error: 'Error al cerrar sesión'
      });
    }

    res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });

    return res.json({
      message: 'Sesión cerrada'
    });
  });
});

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

    if (!email) {
      return res.status(400).json({
        error: 'El correo es obligatorio'
      });
    }

    const userResult = await db.query(
      `
        SELECT id, mail, active
        FROM users
        WHERE mail = $1
          AND active = true
        LIMIT 1
      `,
      [email]
    );

    if (userResult.rowCount === 0) {
      return res.json({
        message: 'Si el correo existe, recibirás instrucciones para restablecer la contraseña'
      });
    }

    const user = userResult.rows[0];
    const rawToken = generateResetToken();
    const tokenDigest = sha256Hex(rawToken);
    const expiresAt = getResetTokenExpiryDate();

    await db.query(
      `
        UPDATE users
        SET
          reset_token_digest = $1,
          reset_token_expires_at = $2
        WHERE id = $3
      `,
      [tokenDigest, expiresAt, user.id]
    );

    await mailService.sendPasswordResetEmail({
      to: user.mail,
      rawToken
    });

    return res.json({
      message: 'Si el correo existe, recibirás instrucciones para restablecer la contraseña'
    });
  } catch (err) {
    console.error('FORGOT PASSWORD ERROR:', err);
    return res.status(500).json({
      error: 'Error interno del servidor'
    });
  }
});

/**
 * POST /newpassword
 *
 * Expects:
 * {
 *   token,
 *   password,
 *   password_confirmation
 * }
 */
router.post('/newpassword', async (req, res) => {
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

    const userResult = await db.query(
      `
        SELECT id
        FROM users
        WHERE reset_token_digest = $1
          AND reset_token_expires_at IS NOT NULL
          AND reset_token_expires_at > NOW()
        LIMIT 1
      `,
      [tokenDigest]
    );

    if (userResult.rowCount === 0) {
      return res.status(400).json({
        error: 'El token es inválido o ha expirado'
      });
    }

    const user = userResult.rows[0];
    const passwordBcrypt = await bcrypt.hash(password, SALT_ROUNDS);

    await db.query(
      `
        UPDATE users
        SET
          password_bcrypt = $1,
          reset_token_digest = NULL,
          reset_token_expires_at = NULL
        WHERE id = $2
      `,
      [passwordBcrypt, user.id]
    );

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
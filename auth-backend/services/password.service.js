const express = require('express');
const passport = require('passport');
const userService = require('../services/user.service');

const router = express.Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongEnoughPassword(password) {
  if (!password || password.length < 10) {
    return false;
  }

  const symbolCount = (password.match(/[^a-zA-Z0-9]/g) || []).length;
  return symbolCount >= 2;
}

router.post('/login', (req, res, next) => {
  passport.authenticate('local', (error, user, info) => {
    if (error) {
      return next(error);
    }

    if (!user) {
      return res.status(401).json({
        error: info?.message || 'Credenciales inválidas.'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        error: 'La cuenta no está activa.'
      });
    }

    req.logIn(user, (loginError) => {
      if (loginError) {
        return next(loginError);
      }

      return res.json({
        ok: true,
        redirectTo: '/'
      });
    });
  })(req, res, next);
});

router.post('/register', async (req, res, next) => {
  try {
    const {
      name,
      lastname,
      dni,
      email,
      gender,
      password,
      password_confirmation: passwordConfirmation
    } = req.body;

    if (!name || !lastname || !dni || !email || !gender || !password || !passwordConfirmation) {
      return res.status(400).json({
        error: 'Faltan campos obligatorios.'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'El correo electrónico no es válido.'
      });
    }

    if (password !== passwordConfirmation) {
      return res.status(400).json({
        error: 'Las contraseñas no coinciden.'
      });
    }

    if (!isStrongEnoughPassword(password)) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 10 caracteres y 2 símbolos.'
      });
    }

    const existingByEmail = await userService.findByEmail(email);
    if (existingByEmail) {
      return res.status(409).json({
        error: 'Ya existe una cuenta con ese correo.'
      });
    }

    const existingByLogin = await userService.findByLogin(dni);
    if (existingByLogin) {
      return res.status(409).json({
        error: 'Ya existe una cuenta con ese identificador.'
      });
    }

    await userService.createUser({
      name,
      lastname,
      dni,
      email,
      gender,
      password
    });

    return res.status(201).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/forgot', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim();

    if (!email) {
      return res.status(400).json({
        error: 'El correo electrónico es obligatorio.'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'El correo electrónico no es válido.'
      });
    }

    const user = await userService.findByEmail(email);

    if (user) {
      const token = await userService.createPasswordReset(email);

      // TODO: Replace with real mail delivery
      console.log(`Password reset token for ${email}: ${token}`);
    }

    return res.json({
      ok: true
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const {
      token,
      password,
      password_confirmation: passwordConfirmation
    } = req.body;

    if (!token || !password || !passwordConfirmation) {
      return res.status(400).json({
        error: 'Faltan datos obligatorios.'
      });
    }

    if (password !== passwordConfirmation) {
      return res.status(400).json({
        error: 'Las contraseñas no coinciden.'
      });
    }

    if (!isStrongEnoughPassword(password)) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 10 caracteres y 2 símbolos.'
      });
    }

    const resetRecord = await userService.findPasswordResetByToken(token);

    if (!resetRecord) {
      return res.status(400).json({
        error: 'El enlace no es válido o ha expirado.'
      });
    }

    await userService.updatePasswordByEmail(resetRecord.mail, password);
    await userService.deletePasswordResetToken(token);

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', (req, res, next) => {
  req.logout((logoutError) => {
    if (logoutError) {
      return next(logoutError);
    }

    req.session.destroy(() => {
      res.clearCookie(process.env.SESSION_COOKIE_NAME || 'auth.sid');
      return res.json({ ok: true });
    });
  });
});

router.get('/me', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({
      error: 'No autenticado.'
    });
  }

  return res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role
  });
});

router.get('/auth/session/check', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).end();
  }

  res.set('X-User-Id', String(req.user.id));
  res.set('X-User-Role', String(req.user.role || 'A'));
  res.set('X-User-Email', String(req.user.email || ''));

  return res.status(200).end();
});

module.exports = router;
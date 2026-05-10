import express from 'express';

import requireManagementRole from '../middleware/requireManagementRole.js';
import { getUserById, listUsers, updateUserById } from '../services/user.service.js';
import { verifyRecaptchaToken } from '../services/recaptcha.service.js';
import {
  triggerForgotPasswordWithAuthBackend,
  verifyAdminPasswordWithAuthBackend
} from '../services/authBackend.service.js';
import { impersonateProfessorInEthicapp } from '../services/ethicapp.service.js';

export function createUsersRouter({
  requireManagementRoleMiddleware = requireManagementRole,
  getUserByIdService = getUserById,
  listUsersService = listUsers,
  updateUserByIdService = updateUserById,
  verifyRecaptchaTokenService = verifyRecaptchaToken,
  triggerForgotPasswordWithAuthBackendService = triggerForgotPasswordWithAuthBackend,
  verifyAdminPasswordWithAuthBackendService = verifyAdminPasswordWithAuthBackend,
  impersonateProfessorInEthicappService = impersonateProfessorInEthicapp
} = {}) {
  const router = express.Router();

  router.get('/mng/api/users', requireManagementRoleMiddleware, async (req, res, next) => {
  try {
    const { q = '', role = '', page = '1' } = req.query;

    const result = await listUsersService({
      keywords: q,
      role,
      page: Number(page),
      pageSize: 10
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
  });

  router.get('/mng/api/users/:id', requireManagementRoleMiddleware, async (req, res, next) => {
  try {
    const user = await getUserByIdService(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json(user);
  } catch (error) {
    return next(error);
  }
  });

  router.put('/mng/api/users/:id', requireManagementRoleMiddleware, async (req, res, next) => {
  try {
    const adminPassword = String(req.body.admin_password || '');
    const recaptchaToken = String(req.body.recaptcha_token || '');

    const isHuman = await verifyRecaptchaTokenService({
      token: recaptchaToken,
      remoteIp: req.ip
    });

    if (!isHuman) {
      return res.status(400).json({ error: 'Invalid recaptcha token' });
    }

    const isAdminPasswordValid = await verifyAdminPasswordWithAuthBackendService({
      password: adminPassword,
      cookie: req.headers.cookie,
      language: req.headers['accept-language']
    });

    if (!isAdminPasswordValid) {
      return res.status(401).json({ error: 'Invalid administrator password' });
    }

    const updatedUser = await updateUserByIdService(req.params.id, req.body);
    return res.status(200).json(updatedUser);
  } catch (error) {
    const errorsByCode = {
      INVALID_USER_ID: 400,
      MISSING_REQUIRED_FIELDS: 400,
      INVALID_GENDER: 400,
      INVALID_ROLE: 400,
      EMAIL_CONFIRMATION_MISMATCH: 400,
      EMAIL_ALREADY_EXISTS: 409,
      USER_NOT_FOUND: 404,
      INVALID_ROLE_TRANSITION: 400
    };

    if (errorsByCode[error.message]) {
      return res.status(errorsByCode[error.message]).json({
        error: error.message
      });
    }

    return next(error);
  }
  });

  router.post('/mng/api/users/:id/password-reset', requireManagementRoleMiddleware, async (req, res, next) => {
  try {
    const user = await getUserByIdService(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.email) {
      return res.status(400).json({ error: 'User does not have an email address' });
    }

    const adminPassword = String(req.body.admin_password || '');
    const recaptchaToken = String(req.body.recaptcha_token || '');

    const isAdminPasswordValid = await verifyAdminPasswordWithAuthBackendService({
      password: adminPassword,
      cookie: req.headers.cookie,
      language: req.headers['accept-language']
    });

    if (!isAdminPasswordValid) {
      return res.status(401).json({ error: 'Invalid administrator password' });
    }

    await triggerForgotPasswordWithAuthBackendService({
      email: user.email,
      recaptchaToken,
      cookie: req.headers.cookie,
      language: req.headers['accept-language']
    });

    return res.status(200).json({
      message: 'Password reset email sent'
    });
  } catch (error) {
    if (error.message === 'FORGOT_REQUEST_FAILED') {
      return res.status(502).json({
        error: 'Unable to trigger forgot-password flow'
      });
    }

    return next(error);
  }
  });

  router.post('/mng/api/users/:id/impersonate-professor', requireManagementRoleMiddleware, async (req, res, next) => {
  try {
    const user = await getUserByIdService(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role !== 'P') {
      return res.status(400).json({ error: 'Only professor accounts can be impersonated' });
    }

    const adminPassword = String(req.body.admin_password || '');
    const recaptchaToken = String(req.body.recaptcha_token || '');

    const isHuman = await verifyRecaptchaTokenService({
      token: recaptchaToken,
      remoteIp: req.ip
    });

    if (!isHuman) {
      return res.status(400).json({ error: 'Invalid recaptcha token' });
    }

    const isAdminPasswordValid = await verifyAdminPasswordWithAuthBackendService({
      password: adminPassword,
      cookie: req.headers.cookie,
      language: req.headers['accept-language']
    });

    if (!isAdminPasswordValid) {
      return res.status(401).json({ error: 'Invalid administrator password' });
    }

    const response = await impersonateProfessorInEthicappService({
      professorId: user.id,
      cookie: req.headers.cookie,
      userId: req.session.uid,
      userRole: req.session.role
    });

    for (const setCookie of response.setCookies) {
      res.append('Set-Cookie', setCookie);
    }

    return res.status(200).json(response.body);
  } catch (error) {
    return next(error);
  }
  });

  return router;
}

export default createUsersRouter();

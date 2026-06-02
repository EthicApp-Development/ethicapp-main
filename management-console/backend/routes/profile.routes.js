import express from 'express';

import requireManagementRole from '../middleware/requireManagementRole.js';
import { getUserById } from '../services/user.service.js';
import {
  changeAdminPasswordWithAuthBackend,
  deleteAdminPasskeyWithAuthBackend,
  finishAdminPasskeyRegistrationWithAuthBackend,
  listAdminPasskeysWithAuthBackend,
  startAdminPasskeyAuthenticationWithAuthBackend,
  startAdminPasskeyRegistrationWithAuthBackend
} from '../services/authBackend.service.js';

function mapProfileUser(user) {
  return {
    id: user.id,
    firstname: user.firstname || '',
    lastname: user.lastname || '',
    email: user.email || '',
    role: user.role || ''
  };
}

function isStrongPassword(password) {
  if (!password || password.length < 10) {
    return false;
  }

  const symbolCount = (password.match(/[^a-zA-Z0-9]/g) || []).length;
  return symbolCount >= 2;
}

export function createProfileRouter({
  requireManagementRoleMiddleware = requireManagementRole,
  getUserByIdService = getUserById,
  changeAdminPasswordWithAuthBackendService = changeAdminPasswordWithAuthBackend,
  listAdminPasskeysWithAuthBackendService = listAdminPasskeysWithAuthBackend,
  startAdminPasskeyRegistrationWithAuthBackendService = startAdminPasskeyRegistrationWithAuthBackend,
  finishAdminPasskeyRegistrationWithAuthBackendService = finishAdminPasskeyRegistrationWithAuthBackend,
  startAdminPasskeyAuthenticationWithAuthBackendService = startAdminPasskeyAuthenticationWithAuthBackend,
  deleteAdminPasskeyWithAuthBackendService = deleteAdminPasskeyWithAuthBackend
} = {}) {
  const router = express.Router();

  router.get('/mng/api/profile', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const user = await getUserByIdService(req.session.uid);

      if (!user) {
        return res.status(404).json({ error: 'Administrator profile not found' });
      }

      return res.status(200).json(mapProfileUser(user));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/mng/api/profile/password', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const currentPassword = String(req.body.current_password || '');
      const newPassword = String(req.body.new_password || '');
      const passwordConfirmation = String(req.body.password_confirmation || '');

      if (!currentPassword || !newPassword || !passwordConfirmation) {
        return res.status(400).json({ error: 'MISSING_REQUIRED_FIELDS' });
      }

      if (newPassword !== passwordConfirmation) {
        return res.status(400).json({ error: 'PASSWORD_CONFIRMATION_MISMATCH' });
      }

      if (!isStrongPassword(newPassword)) {
        return res.status(400).json({ error: 'WEAK_PASSWORD' });
      }

      const result = await changeAdminPasswordWithAuthBackendService({
        currentPassword,
        newPassword,
        passwordConfirmation,
        cookie: req.headers.cookie,
        language: req.headers['accept-language']
      });

      return res.status(200).json({
        message: result.message || 'Password updated successfully'
      });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({
          error: error.message
        });
      }

      return next(error);
    }
  });

  router.get('/mng/api/profile/passkeys', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const result = await listAdminPasskeysWithAuthBackendService({
        cookie: req.headers.cookie,
        language: req.headers['accept-language']
      });

      return res.status(200).json({
        passkeys: result.passkeys || []
      });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({
          error: error.message
        });
      }

      return next(error);
    }
  });

  router.post('/mng/api/profile/passkeys/registration-options', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const password = String(req.body.password || '');

      if (!password) {
        return res.status(400).json({ error: 'MISSING_REQUIRED_FIELDS' });
      }

      const result = await startAdminPasskeyRegistrationWithAuthBackendService({
        password,
        cookie: req.headers.cookie,
        language: req.headers['accept-language'],
        ...(req.headers.origin ? { origin: req.headers.origin } : {})
      });

      return res.status(200).json(result);
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({
          error: error.message
        });
      }

      return next(error);
    }
  });

  router.post('/mng/api/profile/passkeys/register', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      if (!req.body.credential) {
        return res.status(400).json({ error: 'MISSING_REQUIRED_FIELDS' });
      }

      const result = await finishAdminPasskeyRegistrationWithAuthBackendService({
        credential: req.body.credential,
        name: String(req.body.name || ''),
        cookie: req.headers.cookie,
        language: req.headers['accept-language'],
        ...(req.headers.origin ? { origin: req.headers.origin } : {})
      });

      return res.status(201).json(result);
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({
          error: error.message
        });
      }

      return next(error);
    }
  });

  router.post('/mng/api/profile/passkeys/authentication-options', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const result = await startAdminPasskeyAuthenticationWithAuthBackendService({
        cookie: req.headers.cookie,
        language: req.headers['accept-language'],
        ...(req.headers.origin ? { origin: req.headers.origin } : {})
      });

      return res.status(200).json(result);
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({
          error: error.message
        });
      }

      return next(error);
    }
  });

  router.delete('/mng/api/profile/passkeys/:passkeyId', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const passkeyId = Number(req.params.passkeyId);
      const password = String(req.body.password || '');

      if (!Number.isInteger(passkeyId) || passkeyId <= 0 || !password) {
        return res.status(400).json({ error: 'MISSING_REQUIRED_FIELDS' });
      }

      const result = await deleteAdminPasskeyWithAuthBackendService({
        passkeyId,
        password,
        cookie: req.headers.cookie,
        language: req.headers['accept-language']
      });

      return res.status(200).json(result);
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({
          error: error.message
        });
      }

      return next(error);
    }
  });

  return router;
}

export default createProfileRouter();

import express from 'express';

import requireManagementRole from '../middleware/requireManagementRole.js';
import { getUserById, listUsers, updateUserById } from '../services/user.service.js';
import { verifyRecaptchaToken } from '../services/recaptcha.service.js';
import {
  listAdminPasskeysWithAuthBackend,
  triggerAdminPasswordResetWithAuthBackend,
  triggerForgotPasswordWithAuthBackend,
  verifyAdminPasskeyWithAuthBackend,
  verifyAdminPasswordWithAuthBackend
} from '../services/authBackend.service.js';
import { impersonateProfessorInEthicapp } from '../services/ethicapp.service.js';
import { createSensitiveActionVerifier } from '../services/sensitive-action.service.js';
import {
  ACCOUNT_LIFECYCLE_ERRORS,
  confirmPendingAccount
} from '../services/account-lifecycle.service.js';
import {
  ACCOUNT_DELETION_ERRORS,
  deleteNeverActivatedAccount
} from '../services/account-deletion.service.js';

const ACCOUNT_LIFECYCLE_STATUS_BY_CODE = Object.freeze({
  [ACCOUNT_LIFECYCLE_ERRORS.invalidUserId]: 400,
  [ACCOUNT_LIFECYCLE_ERRORS.userNotFound]: 404,
  [ACCOUNT_LIFECYCLE_ERRORS.accountNotPending]: 409,
  [ACCOUNT_LIFECYCLE_ERRORS.accountChanged]: 409
});

const ACCOUNT_DELETION_STATUS_BY_CODE = Object.freeze({
  [ACCOUNT_DELETION_ERRORS.invalidUserId]: 400,
  [ACCOUNT_DELETION_ERRORS.userNotFound]: 404,
  [ACCOUNT_DELETION_ERRORS.accountNotDeletable]: 409,
  [ACCOUNT_DELETION_ERRORS.accountChanged]: 409,
  [ACCOUNT_DELETION_ERRORS.accountReferenced]: 409
});

// Code of an account action whose expected_email is not a string.
const INVALID_EXPECTED_EMAIL = 'INVALID_EXPECTED_EMAIL';

function isValidUserIdParam(value) {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0;
}

export function createUsersRouter({
  requireManagementRoleMiddleware = requireManagementRole,
  getUserByIdService = getUserById,
  listUsersService = listUsers,
  updateUserByIdService = updateUserById,
  verifyRecaptchaTokenService = verifyRecaptchaToken,
  listAdminPasskeysWithAuthBackendService = listAdminPasskeysWithAuthBackend,
  triggerAdminPasswordResetWithAuthBackendService = triggerAdminPasswordResetWithAuthBackend,
  triggerForgotPasswordWithAuthBackendService = triggerForgotPasswordWithAuthBackend,
  verifyAdminPasswordWithAuthBackendService = verifyAdminPasswordWithAuthBackend,
  verifyAdminPasskeyWithAuthBackendService = verifyAdminPasskeyWithAuthBackend,
  impersonateProfessorInEthicappService = impersonateProfessorInEthicapp,
  confirmPendingAccountService = confirmPendingAccount,
  deleteNeverActivatedAccountService = deleteNeverActivatedAccount
} = {}) {
  const router = express.Router();

  const verifySensitiveAction = createSensitiveActionVerifier({
    verifyRecaptchaTokenService,
    listAdminPasskeysService: listAdminPasskeysWithAuthBackendService,
    verifyAdminPasswordService: verifyAdminPasswordWithAuthBackendService,
    verifyAdminPasskeyService: verifyAdminPasskeyWithAuthBackendService
  });

  router.get('/mng/api/users', requireManagementRoleMiddleware, async (req, res, next) => {
  try {
    const { q = '', role = '', status = '', sort = '', page = '1' } = req.query;

    const result = await listUsersService({
      keywords: q,
      role,
      status,
      sort,
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
    const sensitiveActionVerified = await verifySensitiveAction(req, res);
    if (!sensitiveActionVerified) {
      return undefined;
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

    const sensitiveActionVerified = await verifySensitiveAction(req, res);
    if (!sensitiveActionVerified) {
      return undefined;
    }

    if (req.body.passkey_assertion) {
      const result = await triggerAdminPasswordResetWithAuthBackendService({
        email: user.email,
        cookie: req.headers.cookie,
        language: req.headers['accept-language']
      });

      return res.status(200).json({
        message: result.message || 'Password reset email sent'
      });
    }

    await triggerForgotPasswordWithAuthBackendService({
      email: user.email,
      recaptchaToken: String(req.body.recaptcha_token || ''),
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

  // Confirms an account whose owner never confirmed the email, after the
  // step-up confirmation. The body carries `expected_email`, the email the
  // administrator approved. Answers 409 ACCOUNT_NOT_PENDING, with the
  // account's current `status`, for any account that is not pending, and
  // 409 ACCOUNT_CHANGED when expected_email is missing or is not the
  // account's email.
  router.post('/mng/api/users/:id/confirm-account', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      if (!isValidUserIdParam(req.params.id)) {
        return res.status(400).json({ error: ACCOUNT_LIFECYCLE_ERRORS.invalidUserId });
      }

      const expectedEmail = req.body?.expected_email ?? null;
      if (expectedEmail !== null && typeof expectedEmail !== 'string') {
        return res.status(400).json({ error: INVALID_EXPECTED_EMAIL });
      }

      const sensitiveActionVerified = await verifySensitiveAction(req, res);
      if (!sensitiveActionVerified) {
        return undefined;
      }

      const result = await confirmPendingAccountService({
        adminUserId: req.session.uid,
        userId: Number(req.params.id),
        expectedEmail
      });

      return res.status(200).json(result);
    } catch (error) {
      const status = ACCOUNT_LIFECYCLE_STATUS_BY_CODE[error.code];

      if (status) {
        return res.status(status).json({
          error: error.code,
          ...(error.accountStatus ? { status: error.accountStatus } : {})
        });
      }

      return next(error);
    }
  });

  // Deletes an account that was never activated, after the step-up
  // confirmation. The body carries `expected_email`, the email the
  // administrator approved. Answers 200 { id, deleted: true }, or 409 with:
  // - ACCOUNT_NOT_DELETABLE and the account's `status`, for an account that
  //   was ever active, signed in or was anonymized;
  // - ACCOUNT_CHANGED, when expected_email is missing or is not the
  //   account's email;
  // - ACCOUNT_REFERENCED, with `referenced_by` (the first table that holds
  //   a row of the account) and `reference_category`.
  router.delete('/mng/api/users/:id', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      if (!isValidUserIdParam(req.params.id)) {
        return res.status(400).json({ error: ACCOUNT_DELETION_ERRORS.invalidUserId });
      }

      const expectedEmail = req.body?.expected_email ?? null;
      if (expectedEmail !== null && typeof expectedEmail !== 'string') {
        return res.status(400).json({ error: INVALID_EXPECTED_EMAIL });
      }

      const sensitiveActionVerified = await verifySensitiveAction(req, res);
      if (!sensitiveActionVerified) {
        return undefined;
      }

      const result = await deleteNeverActivatedAccountService({
        adminUserId: req.session.uid,
        userId: Number(req.params.id),
        expectedEmail
      });

      return res.status(200).json(result);
    } catch (error) {
      const status = ACCOUNT_DELETION_STATUS_BY_CODE[error.code];

      if (status) {
        return res.status(status).json({
          error: error.code,
          ...(error.accountStatus ? { status: error.accountStatus } : {}),
          ...(error.referencedBy
            ? { referenced_by: error.referencedBy, reference_category: error.referenceCategory }
            : {})
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

    const sensitiveActionVerified = await verifySensitiveAction(req, res);
    if (!sensitiveActionVerified) {
      return undefined;
    }

    const response = await impersonateProfessorInEthicappService({
      professorId: user.id,
      cookie: req.headers.cookie,
      userId: req.session.uid,
      userRole: req.session.role,
      forwardedProto: req.get('X-Forwarded-Proto') || req.protocol,
      forwardedHost: req.get('X-Forwarded-Host') || req.get('Host'),
      forwardedPort: req.get('X-Forwarded-Port') || ''
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

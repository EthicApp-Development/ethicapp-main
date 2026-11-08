import express from 'express';

import { pool } from '../config/database.js';
import requireManagementRole from '../middleware/requireManagementRole.js';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_OUTCOMES,
  recordAdminAuditEventBestEffort
} from '../services/admin-audit.service.js';
import { createUserAccountWithAuthBackend } from '../services/authBackend.service.js';
import { createSensitiveActionVerifier } from '../services/sensitive-action.service.js';

// Creating a student or teacher account (#1170). auth-backend owns the
// account rules, the write and the welcome email; the console checks that
// the administrator confirmed informing the user of the privacy policy and
// the terms of use, checks the step-up, forwards the request over the
// internal network, passes refusals through and records every attempt in
// admin_audit_events. The password, the email and the names are never
// logged or audited.

export const USER_ACCOUNT_ERRORS = Object.freeze({
  privacyNoticeNotConfirmed: 'PRIVACY_NOTICE_NOT_CONFIRMED',
  authBackendError: 'AUTH_BACKEND_ERROR',
  authBackendUnavailable: 'AUTH_BACKEND_UNAVAILABLE'
});

// Reason codes of the audit rows that are not auth-backend's own codes.
export const USER_ACCOUNT_AUDIT_REASONS = Object.freeze({
  privacyNoticeNotConfirmed: 'PRIVACY_NOTICE_NOT_CONFIRMED',
  stepUpRefused: 'STEP_UP_REFUSED',
  authBackendError: 'AUTH_BACKEND_ERROR',
  authBackendUnreachable: 'AUTH_BACKEND_UNREACHABLE',
  welcomeEmailFailed: 'WELCOME_EMAIL_FAILED',
  unexpectedError: 'UNEXPECTED_ERROR'
});

// auth-backend refusals the administrator can act on, answered with the
// same status. Anything else (its access checks, a server error) means the
// console and auth-backend disagree, and is answered 502.
const PASSED_THROUGH_STATUSES = new Set([400, 409]);
const AUDIT_REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
// Roles the audit row may name: the ones auth-backend creates.
const CREATABLE_ROLES = new Set(['A', 'P']);

// The account fields auth-backend receives. The step-up fields stay here.
const ACCOUNT_FIELDS = Object.freeze([
  'firstname',
  'lastname',
  'gender',
  'email',
  'role',
  'preferred_locale',
  'password',
  'password_confirmation'
]);

function accountFrom(body) {
  return Object.fromEntries(ACCOUNT_FIELDS.map((name) => [name, body[name]]));
}

// The requested role, for the audit row, when it is one auth-backend creates.
function targetRoleOf(body) {
  const role = typeof body.role === 'string' ? body.role.trim().toUpperCase() : '';
  return CREATABLE_ROLES.has(role) ? role : null;
}

// Whether auth-backend's code can be passed on and audited as a reason code.
function isCode(code) {
  return typeof code === 'string' && AUDIT_REASON_CODE.test(code);
}

function auditReason(code, fallback) {
  return isCode(code) ? code : fallback;
}

export function createUserAccountRouter({
  requireManagementRoleMiddleware = requireManagementRole,
  verifySensitiveAction = createSensitiveActionVerifier(),
  createUserAccountService = createUserAccountWithAuthBackend,
  recordAuditEvent = (event) => recordAdminAuditEventBestEffort(pool, event),
  logger = console
} = {}) {
  const router = express.Router();

  // Body: the account fields (see ACCOUNT_FIELDS), `privacy_notice_confirmed:
  // true` and the step-up fields. Answers 201 { id, message,
  // welcome_email_sent }; a refusal of auth-backend with its status and
  // { error: <code>, message: <localized text> }.
  router.post('/mng/api/users', requireManagementRoleMiddleware, async (req, res, next) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const targetRole = targetRoleOf(body);
    const audit = (outcome, { reasonCode = null, targetUserId = null } = {}) => recordAuditEvent({
      adminUserId: req.session.uid,
      action: ADMIN_AUDIT_ACTIONS.accountCreate,
      targetUserId,
      targetRole,
      outcome,
      reasonCode
    });

    try {
      // The administrator answers for having informed the user of the
      // privacy policy and the terms of use; this audit row records who did.
      if (body.privacy_notice_confirmed !== true) {
        await audit(ADMIN_AUDIT_OUTCOMES.refused, {
          reasonCode: USER_ACCOUNT_AUDIT_REASONS.privacyNoticeNotConfirmed
        });
        return res.status(400).json({ error: USER_ACCOUNT_ERRORS.privacyNoticeNotConfirmed });
      }

      if (!(await verifySensitiveAction(req, res))) {
        await audit(ADMIN_AUDIT_OUTCOMES.refused, { reasonCode: USER_ACCOUNT_AUDIT_REASONS.stepUpRefused });
        return undefined;
      }

      let result;
      try {
        result = await createUserAccountService({
          account: accountFrom(body),
          cookie: req.headers.cookie,
          language: req.headers['accept-language']
        });
      } catch (error) {
        logger.error('Unable to reach auth-backend to create an account', { error: error?.message });
        await audit(ADMIN_AUDIT_OUTCOMES.failed, { reasonCode: USER_ACCOUNT_AUDIT_REASONS.authBackendUnreachable });
        return res.status(502).json({ error: USER_ACCOUNT_ERRORS.authBackendUnavailable });
      }

      if (result.ok) {
        // A welcome email that could not be sent does not undo the account;
        // the row says so.
        await audit(ADMIN_AUDIT_OUTCOMES.succeeded, {
          targetUserId: result.id,
          reasonCode: result.welcomeEmailSent ? null : USER_ACCOUNT_AUDIT_REASONS.welcomeEmailFailed
        });
        return res.status(201).json({
          id: result.id,
          message: result.message,
          welcome_email_sent: result.welcomeEmailSent
        });
      }

      if (PASSED_THROUGH_STATUSES.has(result.status) && isCode(result.code)) {
        await audit(ADMIN_AUDIT_OUTCOMES.refused, { reasonCode: result.code });
        return res.status(result.status).json({ error: result.code, message: result.message });
      }

      logger.error('auth-backend did not create an account', {
        status: result.status,
        code: result.code
      });
      await audit(ADMIN_AUDIT_OUTCOMES.failed, {
        reasonCode: auditReason(result.code, USER_ACCOUNT_AUDIT_REASONS.authBackendError)
      });
      return res.status(502).json({ error: USER_ACCOUNT_ERRORS.authBackendError });
    } catch (error) {
      // The step-up check itself failed (auth-backend unreachable while
      // listing passkeys, for example).
      if (!res.headersSent) {
        await audit(ADMIN_AUDIT_OUTCOMES.failed, { reasonCode: USER_ACCOUNT_AUDIT_REASONS.unexpectedError });
      }
      return next(error);
    }
  });

  return router;
}

export default createUserAccountRouter();

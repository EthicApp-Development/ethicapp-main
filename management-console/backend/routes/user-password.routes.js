import express from 'express';

import { pool } from '../config/database.js';
import requireManagementRole from '../middleware/requireManagementRole.js';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_OUTCOMES,
  recordAdminAuditEventBestEffort
} from '../services/admin-audit.service.js';
import { setUserPasswordWithAuthBackend } from '../services/authBackend.service.js';
import { createSensitiveActionVerifier } from '../services/sensitive-action.service.js';

// Setting a student's or teacher's password (#889). auth-backend owns the
// password rule and the write; the console checks the step-up, forwards the
// request over the internal network, passes refusals through and records
// every attempt in admin_audit_events. The password itself is never logged,
// audited or echoed.

export const USER_PASSWORD_ERRORS = Object.freeze({
  invalidUserId: 'INVALID_USER_ID',
  invalidExpectedEmail: 'INVALID_EXPECTED_EMAIL',
  authBackendError: 'AUTH_BACKEND_ERROR',
  authBackendUnavailable: 'AUTH_BACKEND_UNAVAILABLE'
});

// Reason codes of the audit rows that are not auth-backend's own codes.
export const USER_PASSWORD_AUDIT_REASONS = Object.freeze({
  stepUpRefused: 'STEP_UP_REFUSED',
  authBackendError: 'AUTH_BACKEND_ERROR',
  authBackendUnreachable: 'AUTH_BACKEND_UNREACHABLE',
  unexpectedError: 'UNEXPECTED_ERROR'
});

// auth-backend refusals the administrator can act on, answered with the
// same status. Anything else (its access checks, a server error) means the
// console and auth-backend disagree, and is answered 502.
const PASSED_THROUGH_STATUSES = new Set([400, 404, 409]);
const AUDIT_REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function parseUserIdParam(value) {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0 && userId <= 2147483647 ? userId : null;
}

// Whether auth-backend's code can be passed on and audited as a reason code.
function isCode(code) {
  return typeof code === 'string' && AUDIT_REASON_CODE.test(code);
}

function auditReason(code, fallback) {
  return isCode(code) ? code : fallback;
}

export function createUserPasswordRouter({
  requireManagementRoleMiddleware = requireManagementRole,
  verifySensitiveAction = createSensitiveActionVerifier(),
  setUserPasswordService = setUserPasswordWithAuthBackend,
  recordAuditEvent = (event) => recordAdminAuditEventBestEffort(pool, event),
  logger = console
} = {}) {
  const router = express.Router();

  // Body: { new_password, password_confirmation, expected_email } plus the
  // step-up fields. Answers 200 { id, message }; a refusal of auth-backend
  // with its status and { error: <code>, message: <localized text> }.
  router.post('/mng/api/users/:id/password', requireManagementRoleMiddleware, async (req, res, next) => {
    let audit = null;

    try {
      const targetUserId = parseUserIdParam(req.params.id);
      if (!targetUserId) {
        return res.status(400).json({ error: USER_PASSWORD_ERRORS.invalidUserId });
      }

      const body = req.body || {};
      const expectedEmail = body.expected_email ?? null;
      if (expectedEmail !== null && typeof expectedEmail !== 'string') {
        return res.status(400).json({ error: USER_PASSWORD_ERRORS.invalidExpectedEmail });
      }

      audit = (outcome, reasonCode = null) => recordAuditEvent({
        adminUserId: req.session.uid,
        action: ADMIN_AUDIT_ACTIONS.accountPasswordSet,
        targetUserId,
        outcome,
        reasonCode
      });

      if (!(await verifySensitiveAction(req, res))) {
        await audit(ADMIN_AUDIT_OUTCOMES.refused, USER_PASSWORD_AUDIT_REASONS.stepUpRefused);
        return undefined;
      }

      let result;
      try {
        result = await setUserPasswordService({
          userId: targetUserId,
          newPassword: body.new_password,
          passwordConfirmation: body.password_confirmation,
          expectedEmail,
          cookie: req.headers.cookie,
          language: req.headers['accept-language']
        });
      } catch (error) {
        logger.error('Unable to reach auth-backend to set a user password', {
          targetUserId,
          error: error?.message
        });
        await audit(ADMIN_AUDIT_OUTCOMES.failed, USER_PASSWORD_AUDIT_REASONS.authBackendUnreachable);
        return res.status(502).json({ error: USER_PASSWORD_ERRORS.authBackendUnavailable });
      }

      if (result.ok) {
        await audit(ADMIN_AUDIT_OUTCOMES.succeeded);
        return res.status(200).json({ id: targetUserId, message: result.message });
      }

      if (PASSED_THROUGH_STATUSES.has(result.status) && isCode(result.code)) {
        await audit(ADMIN_AUDIT_OUTCOMES.refused, result.code);
        return res.status(result.status).json({ error: result.code, message: result.message });
      }

      logger.error('auth-backend did not set a user password', {
        targetUserId,
        status: result.status,
        code: result.code
      });
      await audit(
        ADMIN_AUDIT_OUTCOMES.failed,
        auditReason(result.code, USER_PASSWORD_AUDIT_REASONS.authBackendError)
      );
      return res.status(502).json({ error: USER_PASSWORD_ERRORS.authBackendError });
    } catch (error) {
      // The step-up check itself failed (auth-backend unreachable while
      // listing passkeys, for example).
      if (audit && !res.headersSent) {
        await audit(ADMIN_AUDIT_OUTCOMES.failed, USER_PASSWORD_AUDIT_REASONS.unexpectedError);
      }
      return next(error);
    }
  });

  return router;
}

export default createUserPasswordRouter();

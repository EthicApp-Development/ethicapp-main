import express from 'express';

import { pool } from '../config/database.js';
import requireManagementRole from '../middleware/requireManagementRole.js';
import { ACCOUNT_FORGETTING_ERRORS, forgetStudent } from '../services/account-forgetting.service.js';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_OUTCOMES,
  recordAdminAuditEventBestEffort
} from '../services/admin-audit.service.js';
import { createSensitiveActionVerifier } from '../services/sensitive-action.service.js';
import {
  fetchUserErasureRequestsFromEthicapp,
  retryUserErasureRequestsInEthicapp
} from '../services/user-erasure.service.js';

// Forgetting a student (#876), and the AI Additions erasure requests it
// leaves for ethicapp to process.

const FORGETTING_STATUS_BY_CODE = Object.freeze({
  [ACCOUNT_FORGETTING_ERRORS.invalidUserId]: 400,
  [ACCOUNT_FORGETTING_ERRORS.userNotFound]: 404,
  [ACCOUNT_FORGETTING_ERRORS.accountChanged]: 409,
  [ACCOUNT_FORGETTING_ERRORS.accountAnonymized]: 409,
  [ACCOUNT_FORGETTING_ERRORS.notAStudent]: 409
});

const INVALID_EXPECTED_EMAIL = 'INVALID_EXPECTED_EMAIL';

function parseUserIdParam(value) {
  const userId = Number(value);
  return Number.isInteger(userId) && userId > 0 && userId <= 2147483647 ? userId : null;
}

function requestIdentity(req) {
  return {
    cookie: req.headers.cookie,
    userId: req.session.uid,
    userRole: req.session.role,
    language: req.headers['accept-language']
  };
}

// Reason code of a failed retry in the audit log, from the console's error.
const RETRY_FAILURE_REASONS = Object.freeze({
  unreachable: 'ETHICAPP_UNREACHABLE',
  ethicapp_error: 'ETHICAPP_ERROR',
  invalid_response: 'ETHICAPP_INVALID_RESPONSE'
});

function retryFailureReason(error) {
  return RETRY_FAILURE_REASONS[error] || 'ETHICAPP_ERROR';
}

export function createUserForgettingRouter({
  requireManagementRoleMiddleware = requireManagementRole,
  verifySensitiveAction = createSensitiveActionVerifier(),
  forgetStudentService = forgetStudent,
  fetchErasureRequestsService = fetchUserErasureRequestsFromEthicapp,
  retryErasureRequestsService = retryUserErasureRequestsInEthicapp,
  recordAuditEvent = (event) => recordAdminAuditEventBestEffort(pool, event)
} = {}) {
  const router = express.Router();

  // Forgets a student after the step-up confirmation: disables and
  // anonymizes the account, erases their written responses and the AI
  // service payloads in EthicApp, and records one AI Additions erasure
  // request per service, in one transaction. Answers once it commits; AI
  // Additions is asked later, by ethicapp. The body carries
  // `expected_email`, the email the administrator approved.
  //
  // 409 ACCOUNT_ANONYMIZED, NOT_A_STUDENT or ACCOUNT_CHANGED refuse it.
  router.post('/mng/api/users/:id/forget', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const userId = parseUserIdParam(req.params.id);
      if (!userId) {
        return res.status(400).json({ error: ACCOUNT_FORGETTING_ERRORS.invalidUserId });
      }

      const expectedEmail = req.body?.expected_email ?? null;
      if (expectedEmail !== null && typeof expectedEmail !== 'string') {
        return res.status(400).json({ error: INVALID_EXPECTED_EMAIL });
      }

      const sensitiveActionVerified = await verifySensitiveAction(req, res);
      if (!sensitiveActionVerified) {
        return undefined;
      }

      const result = await forgetStudentService({
        adminUserId: req.session.uid,
        userId,
        expectedEmail
      });

      return res.status(200).json(result);
    } catch (error) {
      const status = FORGETTING_STATUS_BY_CODE[error.code];

      if (status) {
        return res.status(status).json({ error: error.code });
      }

      return next(error);
    }
  });

  // The account's erasure requests, as ethicapp reports them. Answers 200
  // with { ok: true, requests } or { ok: false, error } when ethicapp cannot
  // tell (see USER_ERASURE_ERROR_CODES).
  router.get('/mng/api/users/:id/erasure-requests', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const targetUserId = parseUserIdParam(req.params.id);
      if (!targetUserId) {
        return res.status(400).json({ error: ACCOUNT_FORGETTING_ERRORS.invalidUserId });
      }

      return res.status(200).json(await fetchErasureRequestsService({
        targetUserId,
        ...requestIdentity(req)
      }));
    } catch (error) {
      return next(error);
    }
  });

  // An administrator's retry: ethicapp sets the requests that are not done
  // back to pending, attempts them now and answers with their state. The
  // retry is recorded in the audit log.
  router.post(
    '/mng/api/users/:id/erasure-requests/retry',
    requireManagementRoleMiddleware,
    async (req, res, next) => {
      try {
        const targetUserId = parseUserIdParam(req.params.id);
        if (!targetUserId) {
          return res.status(400).json({ error: ACCOUNT_FORGETTING_ERRORS.invalidUserId });
        }

        const result = await retryErasureRequestsService({
          targetUserId,
          ...requestIdentity(req)
        });

        await recordAuditEvent({
          adminUserId: req.session.uid,
          action: ADMIN_AUDIT_ACTIONS.accountErasureRetry,
          targetUserId,
          outcome: result.ok ? ADMIN_AUDIT_OUTCOMES.succeeded : ADMIN_AUDIT_OUTCOMES.failed,
          reasonCode: result.ok ? null : retryFailureReason(result.error)
        });

        return res.status(200).json(result);
      } catch (error) {
        return next(error);
      }
    }
  );

  return router;
}

export default createUserForgettingRouter();

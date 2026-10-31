import express from 'express';

import { pool } from '../config/database.js';
import requireManagementRole from '../middleware/requireManagementRole.js';
import {
  ACCOUNT_FORGETTING_ERRORS,
  forgetStudent,
  forgetTeacher,
  previewTeacherForgetting
} from '../services/account-forgetting.service.js';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_OUTCOMES,
  recordAdminAuditEventBestEffort
} from '../services/admin-audit.service.js';
import {
  fetchOpenTeacherActivitiesFromEthicapp,
  finishTeacherActivitiesInEthicapp
} from '../services/ethicapp.service.js';
import { createSensitiveActionVerifier } from '../services/sensitive-action.service.js';
import {
  fetchUserErasureRequestsFromEthicapp,
  retryUserErasureRequestsInEthicapp
} from '../services/user-erasure.service.js';

// Forgetting a student (#876) or a teacher (#877), and the background work
// it leaves for ethicapp to process: the AI Additions erasure requests and
// the deletion of files.

const FORGETTING_STATUS_BY_CODE = Object.freeze({
  [ACCOUNT_FORGETTING_ERRORS.invalidUserId]: 400,
  [ACCOUNT_FORGETTING_ERRORS.invalidRecipient]: 400,
  [ACCOUNT_FORGETTING_ERRORS.userNotFound]: 404,
  [ACCOUNT_FORGETTING_ERRORS.accountChanged]: 409,
  [ACCOUNT_FORGETTING_ERRORS.accountAnonymized]: 409,
  [ACCOUNT_FORGETTING_ERRORS.notAStudent]: 409,
  [ACCOUNT_FORGETTING_ERRORS.notATeacher]: 409,
  [ACCOUNT_FORGETTING_ERRORS.recipientUnavailable]: 409,
  [ACCOUNT_FORGETTING_ERRORS.recipientChanged]: 409,
  [ACCOUNT_FORGETTING_ERRORS.openActivities]: 409,
  [ACCOUNT_FORGETTING_ERRORS.activitiesNotFinished]: 502
});

const INVALID_EXPECTED_EMAIL = 'INVALID_EXPECTED_EMAIL';
const INVALID_EXPECTED_ROLE = 'INVALID_EXPECTED_ROLE';

// The roles `expected_role` may name; a request without it forgets a
// student, as before #877.
const FORGETTABLE_ROLES = Object.freeze(['A', 'P']);

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

function isOptionalString(value) {
  return value === null || typeof value === 'string';
}

// The teacher-only fields of the request body, or an error code.
function parseTeacherFields(body) {
  const recipientId = body?.recipient_id ?? null;
  const expectedRecipientEmail = body?.expected_recipient_email ?? null;

  if (
    (recipientId !== null && (!Number.isInteger(recipientId) || recipientId <= 0)) ||
    !isOptionalString(expectedRecipientEmail)
  ) {
    return { error: ACCOUNT_FORGETTING_ERRORS.invalidRecipient };
  }

  return { recipientId, expectedRecipientEmail };
}

function sendForgettingError(res, error) {
  const status = FORGETTING_STATUS_BY_CODE[error.code];
  if (!status) {
    return false;
  }

  const body = { error: error.code };
  if (error.code === ACCOUNT_FORGETTING_ERRORS.activitiesNotFinished) {
    body.reason = error.reason;
    body.failedActivities = error.failedActivities;
  }
  res.status(status).json(body);
  return true;
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
  forgetTeacherService = forgetTeacher,
  previewTeacherForgettingService = previewTeacherForgetting,
  fetchOpenTeacherActivitiesService = fetchOpenTeacherActivitiesFromEthicapp,
  finishTeacherActivitiesService = finishTeacherActivitiesInEthicapp,
  fetchErasureRequestsService = fetchUserErasureRequestsFromEthicapp,
  retryErasureRequestsService = retryUserErasureRequestsInEthicapp,
  recordAuditEvent = (event) => recordAdminAuditEventBestEffort(pool, event)
} = {}) {
  const router = express.Router();

  // Forgets an account after the step-up confirmation. The body carries
  // `expected_email`, the email the administrator approved, and
  // `expected_role`, the role the dialog was for: `A` (the default) or `P`.
  //
  // A student is disabled and anonymized, with their written responses, the
  // AI service payloads in EthicApp, one AI Additions erasure request per
  // service and the deletion of their profile images, in one transaction.
  //
  // A teacher's open activities are first finished by ethicapp; then one
  // transaction anonymizes the account and handles their materials. The body
  // may name `recipient_id`, the teacher who receives the remaining cases,
  // designs and activities, with `expected_recipient_email`.
  //
  // Answers once the transaction commits; AI Additions and the files are
  // handled later, by ethicapp. Refusals answer 400, 404, 409 or, when
  // ethicapp could not finish the activities, 502 ACTIVITIES_NOT_FINISHED
  // with `reason` and `failedActivities`.
  router.post('/mng/api/users/:id/forget', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const userId = parseUserIdParam(req.params.id);
      if (!userId) {
        return res.status(400).json({ error: ACCOUNT_FORGETTING_ERRORS.invalidUserId });
      }

      const expectedEmail = req.body?.expected_email ?? null;
      if (!isOptionalString(expectedEmail)) {
        return res.status(400).json({ error: INVALID_EXPECTED_EMAIL });
      }

      const expectedRole = req.body?.expected_role ?? 'A';
      if (!FORGETTABLE_ROLES.includes(expectedRole)) {
        return res.status(400).json({ error: INVALID_EXPECTED_ROLE });
      }

      const teacherFields = expectedRole === 'P' ? parseTeacherFields(req.body) : null;
      if (teacherFields?.error) {
        return res.status(400).json({ error: teacherFields.error });
      }

      const sensitiveActionVerified = await verifySensitiveAction(req, res);
      if (!sensitiveActionVerified) {
        return undefined;
      }

      const adminUserId = req.session.uid;
      const result = expectedRole === 'P'
        ? await forgetTeacherService({
          adminUserId,
          userId,
          expectedEmail,
          recipientId: teacherFields.recipientId,
          expectedRecipientEmail: teacherFields.expectedRecipientEmail,
          finishActivities: () => finishTeacherActivitiesService({
            teacherId: userId,
            ...requestIdentity(req)
          })
        })
        : await forgetStudentService({ adminUserId, userId, expectedEmail });

      return res.status(200).json(result);
    } catch (error) {
      if (sendForgettingError(res, error)) {
        return undefined;
      }
      return next(error);
    }
  });

  // What forgetting a teacher would do, for the dialog: the open activities
  // ethicapp would finish first, and the cases and designs that would be
  // deleted or kept, and the copies other teachers made. Changes nothing.
  router.get('/mng/api/users/:id/forget-preview', requireManagementRoleMiddleware, async (req, res, next) => {
    try {
      const userId = parseUserIdParam(req.params.id);
      if (!userId) {
        return res.status(400).json({ error: ACCOUNT_FORGETTING_ERRORS.invalidUserId });
      }

      const preview = await previewTeacherForgettingService({
        userId,
        fetchOpenActivities: () => fetchOpenTeacherActivitiesService({
          teacherId: userId,
          ...requestIdentity(req)
        })
      });

      return res.status(200).json(preview);
    } catch (error) {
      if (sendForgettingError(res, error)) {
        return undefined;
      }
      return next(error);
    }
  });

  // The account's background erasure, as ethicapp reports it: the AI
  // Additions erasure requests and the deletion of files. Answers 200 with
  // { ok: true, requests, uploadDeletions } or { ok: false, error } when
  // ethicapp cannot tell (see USER_ERASURE_ERROR_CODES).
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

  // An administrator's retry: ethicapp sets the erasure requests and file
  // deletions that are not done back to pending, attempts them now and
  // answers with their state. The retry is recorded in the audit log.
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

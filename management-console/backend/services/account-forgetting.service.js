import { pool as defaultPool } from '../config/database.js';
import { ACCOUNT_STATUSES } from './account-status.js';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_OUTCOMES,
  recordAdminAuditEvent,
  recordAdminAuditEventBestEffort
} from './admin-audit.service.js';
import {
  STUDENT_ROLE,
  anonymizeStudentAccountInTransaction,
  createAnonymizationRun,
  finalizeAnonymizationRun,
  parseStudentAnonymizationOptions
} from '../helpers/student-anonymization-helper.js';

// Error codes of forgetting a student. Routes map them to HTTP statuses and
// the frontend translates them, so they are part of the API contract.
export const ACCOUNT_FORGETTING_ERRORS = Object.freeze({
  invalidUserId: 'INVALID_USER_ID',
  userNotFound: 'USER_NOT_FOUND',
  accountChanged: 'ACCOUNT_CHANGED',
  accountAnonymized: 'ACCOUNT_ANONYMIZED',
  notAStudent: 'NOT_A_STUDENT'
});

// Process name of the anonymization runs the console starts, beside the
// scheduled job's `student-anonymization-job`.
export const FORGETTING_PROCESS_NAME = 'mng-console';

const UNEXPECTED_ERROR_REASON = 'UNEXPECTED_ERROR';

function forgettingError(code) {
  return Object.assign(new Error(code), { code });
}

function normalizeUserId(userId) {
  const normalizedId = Number(userId);
  return Number.isInteger(normalizedId) && normalizedId > 0 ? normalizedId : null;
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isExpectedEmail(expectedEmail, storedEmail) {
  const expected = normalizeEmail(expectedEmail);
  return expected !== '' && expected === normalizeEmail(storedEmail);
}

// Why an account cannot be forgotten, or null when it can.
function refusalFor(current, expectedEmail) {
  if (current.anonymized_at) {
    return ACCOUNT_FORGETTING_ERRORS.accountAnonymized;
  }
  if (current.role !== STUDENT_ROLE) {
    return ACCOUNT_FORGETTING_ERRORS.notAStudent;
  }
  if (!isExpectedEmail(expectedEmail, current.mail)) {
    return ACCOUNT_FORGETTING_ERRORS.accountChanged;
  }
  return null;
}

// Makes EthicApp forget one student on an administrator's request (#876),
// with the per-account step of the scheduled anonymization.
export function createAccountForgettingService({
  pool = defaultPool,
  env = process.env,
  logger = console
} = {}) {
  // The same placeholder as the scheduled job, so both leave the same text.
  const { placeholderText } = parseStudentAnonymizationOptions([], env);

  async function withTransaction(callback) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Unable to roll back account forgetting transaction', {
          error: rollbackError?.message
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  // Forgets a student in one transaction: an anonymization run of one
  // account (triggered_by `admin-user:<id>`, process `mng-console`), the
  // per-account step (account, written responses, AI service payloads, and
  // one pending erasure request per AI Additions service), the run's
  // finalization and the audit row. When it resolves, the account is
  // disabled and anonymized; AI Additions is asked to erase its data later,
  // by ethicapp.
  //
  // `expectedEmail` is the email the administrator saw when approving it:
  // the account is forgotten only while it still has that email.
  //
  // Resolves to { id, status: 'anonymized', runId, erasureRequests }.
  // Rejects with an Error whose `code` is one of ACCOUNT_FORGETTING_ERRORS:
  // INVALID_USER_ID and USER_NOT_FOUND record nothing; ACCOUNT_ANONYMIZED,
  // NOT_A_STUDENT and ACCOUNT_CHANGED change nothing and record the refusal.
  // An unexpected failure rolls back and is recorded as failed, best effort.
  async function forgetStudent({ adminUserId, userId, expectedEmail = null }) {
    const targetUserId = normalizeUserId(userId);

    if (!targetUserId) {
      throw forgettingError(ACCOUNT_FORGETTING_ERRORS.invalidUserId);
    }

    const auditEvent = {
      adminUserId,
      action: ADMIN_AUDIT_ACTIONS.accountForget,
      targetUserId
    };

    let result;

    try {
      result = await withTransaction(async (client) => {
        const currentResult = await client.query(
          `
            SELECT id, mail, role, anonymized_at
            FROM users
            WHERE id = $1
            FOR UPDATE
          `,
          [targetUserId]
        );

        if (currentResult.rowCount === 0) {
          throw forgettingError(ACCOUNT_FORGETTING_ERRORS.userNotFound);
        }

        const refusal = refusalFor(currentResult.rows[0], expectedEmail);

        if (refusal) {
          await recordAdminAuditEvent(client, {
            ...auditEvent,
            outcome: ADMIN_AUDIT_OUTCOMES.refused,
            reasonCode: refusal
          });
          return { refusal };
        }

        const runOptions = {
          dryRun: false,
          placeholderText,
          triggeredBy: `admin-user:${Number(adminUserId)}`,
          processName: FORGETTING_PROCESS_NAME
        };
        const runId = await createAnonymizationRun(client, runOptions, 1);
        const stepResult = await anonymizeStudentAccountInTransaction(
          client,
          runId,
          { id: targetUserId },
          runOptions
        );

        // The account is locked and was checked above, so the step cannot
        // skip it; if it did, nothing is committed.
        if (stepResult.status !== 'succeeded') {
          throw new Error(`Unexpected anonymization step status: ${stepResult.status}`);
        }

        await finalizeAnonymizationRun(client, runId, { total: 1, succeeded: 1, failed: 0 });
        await recordAdminAuditEvent(client, {
          ...auditEvent,
          outcome: ADMIN_AUDIT_OUTCOMES.succeeded
        });

        return {
          id: targetUserId,
          status: ACCOUNT_STATUSES.anonymized,
          runId,
          erasureRequests: stepResult.erasureServiceIds.map((serviceId) => ({
            serviceId,
            status: 'pending',
            attempts: 0
          }))
        };
      });
    } catch (error) {
      if (error.code !== ACCOUNT_FORGETTING_ERRORS.userNotFound) {
        await recordAdminAuditEventBestEffort(pool, {
          ...auditEvent,
          outcome: ADMIN_AUDIT_OUTCOMES.failed,
          reasonCode: UNEXPECTED_ERROR_REASON
        }, logger);
      }
      throw error;
    }

    if (result.refusal) {
      throw forgettingError(result.refusal);
    }

    return result;
  }

  return { forgetStudent };
}

const defaultService = createAccountForgettingService();

export const { forgetStudent } = defaultService;

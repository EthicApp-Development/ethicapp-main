import { pool as defaultPool } from '../config/database.js';
import { ACCOUNT_STATUSES, deriveAccountStatus } from './account-status.js';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_OUTCOMES,
  recordAdminAuditEvent,
  recordAdminAuditEventBestEffort
} from './admin-audit.service.js';

// Error codes of the account lifecycle actions. Routes map them to HTTP
// statuses and the frontend translates them, so they are part of the API
// contract.
export const ACCOUNT_LIFECYCLE_ERRORS = Object.freeze({
  invalidUserId: 'INVALID_USER_ID',
  userNotFound: 'USER_NOT_FOUND',
  accountNotPending: 'ACCOUNT_NOT_PENDING'
});

// Reason code of an action that failed unexpectedly and was rolled back.
const UNEXPECTED_ERROR_REASON = 'UNEXPECTED_ERROR';

function lifecycleError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

function normalizeUserId(userId) {
  const normalizedId = Number(userId);
  return Number.isInteger(normalizedId) && normalizedId > 0 ? normalizedId : null;
}

// Administrator actions on the lifecycle of an account. Each action runs in
// one transaction on a dedicated client and records itself in
// admin_audit_events (V27).
export function createAccountLifecycleService({
  pool = defaultPool,
  logger = console
} = {}) {
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
        logger.error('Unable to roll back account lifecycle transaction', {
          error: rollbackError?.message
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  // Confirms an account whose owner never confirmed the email: sets
  // active = true and email_confirmed = true, and deletes the email's
  // pending account_confirmation tokens. The account keeps the password its
  // owner chose at sign-up.
  //
  // Resolves to { id, status: 'active' }. Rejects with an Error whose `code`
  // is one of ACCOUNT_LIFECYCLE_ERRORS:
  // - INVALID_USER_ID, USER_NOT_FOUND: nothing is recorded;
  // - ACCOUNT_NOT_PENDING, with `accountStatus` set to the current status:
  //   the refusal is recorded.
  // An unexpected failure rolls back and is recorded as failed, best effort.
  async function confirmPendingAccount({ adminUserId, userId }) {
    const targetUserId = normalizeUserId(userId);

    if (!targetUserId) {
      throw lifecycleError(ACCOUNT_LIFECYCLE_ERRORS.invalidUserId);
    }

    const auditEvent = {
      adminUserId,
      action: ADMIN_AUDIT_ACTIONS.accountConfirm,
      targetUserId
    };

    let result;

    try {
      result = await withTransaction(async (client) => {
        const currentResult = await client.query(
          `
            SELECT id, mail, active, email_confirmed, anonymized_at
            FROM users
            WHERE id = $1
            FOR UPDATE
          `,
          [targetUserId]
        );

        if (currentResult.rowCount === 0) {
          throw lifecycleError(ACCOUNT_LIFECYCLE_ERRORS.userNotFound);
        }

        const current = currentResult.rows[0];
        const status = deriveAccountStatus({
          active: current.active,
          emailConfirmed: current.email_confirmed,
          anonymizedAt: current.anonymized_at
        });

        if (status !== ACCOUNT_STATUSES.pending) {
          await recordAdminAuditEvent(client, {
            ...auditEvent,
            outcome: ADMIN_AUDIT_OUTCOMES.refused,
            reasonCode: ACCOUNT_LIFECYCLE_ERRORS.accountNotPending
          });
          return { refusedStatus: status };
        }

        await client.query(
          `
            UPDATE users
            SET active = true,
                email_confirmed = true
            WHERE id = $1
          `,
          [targetUserId]
        );

        await client.query(
          `
            DELETE FROM pass_reset
            WHERE lower(mail) = lower($1)
              AND token_purpose = 'account_confirmation'
          `,
          [current.mail]
        );

        await recordAdminAuditEvent(client, {
          ...auditEvent,
          outcome: ADMIN_AUDIT_OUTCOMES.succeeded
        });

        return { id: targetUserId, status: ACCOUNT_STATUSES.active };
      });
    } catch (error) {
      if (error.code !== ACCOUNT_LIFECYCLE_ERRORS.userNotFound) {
        await recordAdminAuditEventBestEffort(pool, {
          ...auditEvent,
          outcome: ADMIN_AUDIT_OUTCOMES.failed,
          reasonCode: UNEXPECTED_ERROR_REASON
        }, logger);
      }
      throw error;
    }

    // The refusal is reported once it is committed with its audit row.
    if (result.refusedStatus) {
      throw lifecycleError(ACCOUNT_LIFECYCLE_ERRORS.accountNotPending, {
        accountStatus: result.refusedStatus
      });
    }

    return result;
  }

  return { confirmPendingAccount };
}

const defaultService = createAccountLifecycleService();

export const { confirmPendingAccount } = defaultService;

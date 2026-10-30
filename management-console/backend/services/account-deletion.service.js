import { pool as defaultPool } from '../config/database.js';
import { deriveAccountStatus } from './account-status.js';
import {
  ACCOUNT_LIFECYCLE_ERRORS,
  isExpectedEmail,
  lifecycleError,
  normalizeUserId
} from './account-lifecycle.service.js';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_OUTCOMES,
  recordAdminAuditEvent,
  recordAdminAuditEventBestEffort
} from './admin-audit.service.js';
import {
  BLOCKING_USER_REFERENCES,
  buildBlockingReferencesQuery,
  userReferenceReasonCode
} from './user-references.js';

// Error codes of the deletion of a never-activated account. Routes map them
// to HTTP statuses and the frontend translates them, so they are part of the
// API contract.
export const ACCOUNT_DELETION_ERRORS = Object.freeze({
  invalidUserId: ACCOUNT_LIFECYCLE_ERRORS.invalidUserId,
  userNotFound: ACCOUNT_LIFECYCLE_ERRORS.userNotFound,
  accountChanged: ACCOUNT_LIFECYCLE_ERRORS.accountChanged,
  accountNotDeletable: 'ACCOUNT_NOT_DELETABLE',
  accountReferenced: 'ACCOUNT_REFERENCED'
});

// Reason code of a deletion that failed unexpectedly and was rolled back.
const UNEXPECTED_ERROR_REASON = 'UNEXPECTED_ERROR';

// Whether an account was never activated: its owner signed up, never
// confirmed the email and never signed in, no administrator activated it,
// and it was not anonymized. An account an administrator deactivated was
// active once, so it does not qualify.
export function isNeverActivatedAccount({ active, emailConfirmed, anonymizedAt, lastLoginAt }) {
  return active === false &&
    emailConfirmed === false &&
    !anonymizedAt &&
    !lastLoginAt;
}

export function createAccountDeletionService({
  pool = defaultPool,
  logger = console
} = {}) {
  const blockingReferencesQuery = buildBlockingReferencesQuery(BLOCKING_USER_REFERENCES);

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
        logger.error('Unable to roll back account deletion transaction', {
          error: rollbackError?.message
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  // Returns the refusal for the locked account `current` ({ code,
  // reasonCode, details }), or null when it may be deleted.
  async function findRefusal(client, current, expectedEmail) {
    const neverActivated = isNeverActivatedAccount({
      active: current.active,
      emailConfirmed: current.email_confirmed,
      anonymizedAt: current.anonymized_at,
      lastLoginAt: current.last_login_at
    });

    if (!neverActivated) {
      return {
        code: ACCOUNT_DELETION_ERRORS.accountNotDeletable,
        reasonCode: ACCOUNT_DELETION_ERRORS.accountNotDeletable,
        details: {
          accountStatus: deriveAccountStatus({
            active: current.active,
            emailConfirmed: current.email_confirmed,
            anonymizedAt: current.anonymized_at
          })
        }
      };
    }

    if (!isExpectedEmail(expectedEmail, current.mail)) {
      return {
        code: ACCOUNT_DELETION_ERRORS.accountChanged,
        reasonCode: ACCOUNT_DELETION_ERRORS.accountChanged
      };
    }

    const referenceResult = await client.query(blockingReferencesQuery, [current.id]);

    if (referenceResult.rowCount > 0) {
      const entry = BLOCKING_USER_REFERENCES[referenceResult.rows[0].position];
      return {
        code: ACCOUNT_DELETION_ERRORS.accountReferenced,
        reasonCode: userReferenceReasonCode(entry),
        details: {
          referencedBy: entry.table,
          referenceCategory: entry.category
        }
      };
    }

    return null;
  }

  // Deletes an account that was never activated (isNeverActivatedAccount),
  // with the pass_reset tokens of its email, so the email can sign up again.
  //
  // `expectedEmail` is the email the administrator saw when approving the
  // deletion; the account is deleted only while it still has that email.
  //
  // The account row is locked first. A row inserted meanwhile into a table
  // with a foreign key to users waits for the lock and then fails, so the
  // check of the blocking references (user-references.js) holds until the
  // commit. Foreign keys with CASCADE or SET NULL handle the rest.
  //
  // Resolves to { id, deleted: true }. Rejects with an Error whose `code` is
  // one of ACCOUNT_DELETION_ERRORS:
  // - INVALID_USER_ID, USER_NOT_FOUND: nothing is recorded;
  // - ACCOUNT_NOT_DELETABLE, with `accountStatus`; ACCOUNT_CHANGED; and
  //   ACCOUNT_REFERENCED, with `referencedBy` (the first blocking table) and
  //   `referenceCategory`: nothing changes and the refusal is recorded, the
  //   last one with the reason code REFERENCED_BY_<TABLE>.
  // An unexpected failure rolls back and is recorded as failed, best effort.
  async function deleteNeverActivatedAccount({ adminUserId, userId, expectedEmail = null }) {
    const targetUserId = normalizeUserId(userId);

    if (!targetUserId) {
      throw lifecycleError(ACCOUNT_DELETION_ERRORS.invalidUserId);
    }

    const auditEvent = {
      adminUserId,
      action: ADMIN_AUDIT_ACTIONS.accountDelete,
      targetUserId
    };

    let result;

    try {
      result = await withTransaction(async (client) => {
        const currentResult = await client.query(
          `
            SELECT id, mail, active, email_confirmed, anonymized_at, last_login_at
            FROM users
            WHERE id = $1
            FOR UPDATE
          `,
          [targetUserId]
        );

        if (currentResult.rowCount === 0) {
          throw lifecycleError(ACCOUNT_DELETION_ERRORS.userNotFound);
        }

        const current = currentResult.rows[0];
        const refusal = await findRefusal(client, current, expectedEmail);

        if (refusal) {
          await recordAdminAuditEvent(client, {
            ...auditEvent,
            outcome: ADMIN_AUDIT_OUTCOMES.refused,
            reasonCode: refusal.reasonCode
          });
          return { refusal };
        }

        await client.query(
          `
            DELETE FROM pass_reset
            WHERE lower(mail) = lower($1)
          `,
          [current.mail]
        );

        await client.query('DELETE FROM users WHERE id = $1', [targetUserId]);

        await recordAdminAuditEvent(client, {
          ...auditEvent,
          outcome: ADMIN_AUDIT_OUTCOMES.succeeded
        });

        return { id: targetUserId, deleted: true };
      });
    } catch (error) {
      if (error.code !== ACCOUNT_DELETION_ERRORS.userNotFound) {
        await recordAdminAuditEventBestEffort(pool, {
          ...auditEvent,
          outcome: ADMIN_AUDIT_OUTCOMES.failed,
          reasonCode: UNEXPECTED_ERROR_REASON
        }, logger);
      }
      throw error;
    }

    // The refusal is reported once it is committed with its audit row.
    if (result.refusal) {
      const { code, details } = result.refusal;
      throw lifecycleError(code, details);
    }

    return result;
  }

  return { deleteNeverActivatedAccount };
}

const defaultService = createAccountDeletionService();

export const { deleteNeverActivatedAccount } = defaultService;

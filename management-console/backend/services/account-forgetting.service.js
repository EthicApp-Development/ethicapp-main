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
  TEACHER_ROLE,
  anonymizeAccountInTransaction,
  buildAnonymousTeacherIdentity,
  createAnonymizationRun,
  finalizeAnonymizationRun,
  parseStudentAnonymizationOptions
} from '../helpers/student-anonymization-helper.js';
import {
  countOpenActivities,
  handleTeacherMaterials,
  previewTeacherMaterials
} from '../helpers/teacher-materials-helper.js';
import { recordUploadDeletionRequests } from '../helpers/upload-deletion-helper.js';

// Error codes of forgetting an account. Routes map them to HTTP statuses and
// the frontend translates them, so they are part of the API contract.
export const ACCOUNT_FORGETTING_ERRORS = Object.freeze({
  invalidUserId: 'INVALID_USER_ID',
  userNotFound: 'USER_NOT_FOUND',
  accountChanged: 'ACCOUNT_CHANGED',
  accountAnonymized: 'ACCOUNT_ANONYMIZED',
  notAStudent: 'NOT_A_STUDENT',
  notATeacher: 'NOT_A_TEACHER',
  // The recipient id is not a positive integer, or is the teacher's own.
  invalidRecipient: 'INVALID_RECIPIENT',
  // The recipient is not an active, non-anonymized teacher any more.
  recipientUnavailable: 'RECIPIENT_UNAVAILABLE',
  // The recipient's email is not the one the administrator approved.
  recipientChanged: 'RECIPIENT_CHANGED',
  // An activity of the teacher is open again after ethicapp finished them.
  openActivities: 'OPEN_ACTIVITIES',
  // ethicapp could not finish the teacher's open activities; `reason` holds
  // its error code (unreachable, finish_incomplete, ...).
  activitiesNotFinished: 'ACTIVITIES_NOT_FINISHED'
});

// Process name of the anonymization runs the console starts, beside the
// scheduled job's `student-anonymization-job`.
export const FORGETTING_PROCESS_NAME = 'mng-console';

const UNEXPECTED_ERROR_REASON = 'UNEXPECTED_ERROR';

function forgettingError(code, details = {}) {
  return Object.assign(new Error(code), { code }, details);
}

function normalizeUserId(userId) {
  const normalizedId = Number(userId);
  return Number.isInteger(normalizedId) && normalizedId > 0 && normalizedId <= 2147483647
    ? normalizedId
    : null;
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isExpectedEmail(expectedEmail, storedEmail) {
  const expected = normalizeEmail(expectedEmail);
  return expected !== '' && expected === normalizeEmail(storedEmail);
}

const ROLE_REFUSALS = Object.freeze({
  [STUDENT_ROLE]: ACCOUNT_FORGETTING_ERRORS.notAStudent,
  [TEACHER_ROLE]: ACCOUNT_FORGETTING_ERRORS.notATeacher
});

// Why an account cannot be forgotten as `role`, or null when it can.
function refusalFor(current, role, expectedEmail) {
  if (current.anonymized_at) {
    return ACCOUNT_FORGETTING_ERRORS.accountAnonymized;
  }
  if (current.role !== role) {
    return ROLE_REFUSALS[role];
  }
  if (!isExpectedEmail(expectedEmail, current.mail)) {
    return ACCOUNT_FORGETTING_ERRORS.accountChanged;
  }
  return null;
}

// Why `recipient` cannot receive a teacher's materials, or null when it can:
// an active teacher that is not anonymized, with the email the
// administrator approved.
function recipientRefusalFor(recipient, expectedRecipientEmail) {
  if (
    !recipient ||
    recipient.anonymized_at ||
    recipient.role !== TEACHER_ROLE ||
    recipient.active === false
  ) {
    return ACCOUNT_FORGETTING_ERRORS.recipientUnavailable;
  }
  if (!isExpectedEmail(expectedRecipientEmail, recipient.mail)) {
    return ACCOUNT_FORGETTING_ERRORS.recipientChanged;
  }
  return null;
}

const ACCOUNTS_SQL = `
  SELECT id, mail, role, active, anonymized_at
  FROM users
  WHERE id = ANY($1::integer[])
  ORDER BY id
`;

// Reads the accounts, locked when `lock` is set. Locks are taken in id order,
// so two forgettings that name each other as recipient cannot deadlock.
async function readAccounts(executor, ids, { lock = false } = {}) {
  const result = await executor.query(`${ACCOUNTS_SQL}${lock ? ' FOR UPDATE' : ''}`, [ids]);
  return new Map(result.rows.map((row) => [Number(row.id), row]));
}

// The erasure requests a forgetting recorded, as the API reports them.
function pendingErasureRequests(serviceIds) {
  return serviceIds.map((serviceId) => ({ serviceId, status: 'pending', attempts: 0 }));
}

// Makes EthicApp forget a student (#876) or a teacher (#877) on an
// administrator's request, with the per-account step of the scheduled
// anonymization.
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

  function runOptionsFor(adminUserId, targetRole) {
    return {
      dryRun: false,
      placeholderText,
      triggeredBy: `admin-user:${Number(adminUserId)}`,
      processName: FORGETTING_PROCESS_NAME,
      targetRole
    };
  }

  // Runs `work` as one forgetting: an unexpected failure is recorded as
  // failed, best effort, and rethrown; a refusal `work` returns is thrown
  // after its transaction committed the audit row.
  async function audited(auditEvent, work) {
    let result;

    try {
      result = await work();
    } catch (error) {
      if (error.code !== ACCOUNT_FORGETTING_ERRORS.userNotFound && !error.audited) {
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

  async function refuse(executor, auditEvent, refusal) {
    await recordAdminAuditEvent(executor, {
      ...auditEvent,
      outcome: ADMIN_AUDIT_OUTCOMES.refused,
      reasonCode: refusal
    });
    return { refusal };
  }

  // Forgets a student in one transaction: an anonymization run of one
  // account (triggered_by `admin-user:<id>`, process `mng-console`), the
  // per-account step (account, written responses, AI service payloads, one
  // pending erasure request per AI Additions service and the deletion of
  // the profile images), the run's finalization and the audit row. When it
  // resolves, the account is disabled and anonymized; AI Additions is asked
  // to erase its data, and the files are deleted, later, by ethicapp.
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
      targetUserId,
      targetRole: STUDENT_ROLE
    };

    return audited(auditEvent, () => withTransaction(async (client) => {
      const current = (await readAccounts(client, [targetUserId], { lock: true })).get(targetUserId);

      if (!current) {
        throw forgettingError(ACCOUNT_FORGETTING_ERRORS.userNotFound);
      }

      const refusal = refusalFor(current, STUDENT_ROLE, expectedEmail);
      if (refusal) {
        return refuse(client, auditEvent, refusal);
      }

      const runOptions = runOptionsFor(adminUserId, STUDENT_ROLE);
      const runId = await createAnonymizationRun(client, runOptions, 1);
      const stepResult = await anonymizeAccountInTransaction(client, runId, { id: targetUserId }, runOptions);

      // The account is locked and was checked above, so the step cannot
      // skip it; if it did, nothing is committed.
      if (stepResult.status !== 'succeeded') {
        throw new Error(`Unexpected anonymization step status: ${stepResult.status}`);
      }

      await finalizeAnonymizationRun(client, runId, { total: 1, succeeded: 1, failed: 0 });
      await recordAdminAuditEvent(client, { ...auditEvent, outcome: ADMIN_AUDIT_OUTCOMES.succeeded });

      return {
        id: targetUserId,
        status: ACCOUNT_STATUSES.anonymized,
        runId,
        erasureRequests: pendingErasureRequests(stepResult.erasureServiceIds)
      };
    }));
  }

  // The refusal of the target teacher and of the recipient, or null.
  function teacherRefusal(accounts, { teacherId, expectedEmail, recipientId, expectedRecipientEmail }) {
    const refusal = refusalFor(accounts.get(teacherId), TEACHER_ROLE, expectedEmail);
    if (refusal || !recipientId) {
      return refusal;
    }
    return recipientRefusalFor(accounts.get(recipientId), expectedRecipientEmail);
  }

  // Forgets a teacher (#877):
  //
  // 1. Checks the teacher and the recipient without locking them, so a
  //    request the transaction would refuse finishes no activity.
  // 2. Has ethicapp finish every open activity of the teacher, with its hooks
  //    and student notifications (`finishActivities`, #881). If that fails or
  //    leaves an activity open, the forgetting stops: nothing is anonymized.
  // 3. In one transaction: locks the teacher and the recipient, checks them
  //    again, and refuses with OPEN_ACTIVITIES when an activity is open
  //    again; then an anonymization run of one teacher, the materials
  //    (teacher-materials-helper.js: deleted, transferred to the recipient
  //    or kept, author emails erased), the per-account step, the deletion of
  //    the deleted cases' files, the run's finalization and the audit row.
  //
  // `recipientId` is optional: without it, the remaining materials and the
  // activities stay under the anonymized account. With it,
  // `expectedRecipientEmail` is the recipient's email the administrator saw.
  //
  // `finishActivities()` resolves like finishTeacherActivitiesInEthicapp:
  // { ok, error, finished, skipped, failed }.
  //
  // Resolves to { id, status: 'anonymized', runId, recipientId,
  // activitiesFinished, materials, uploadDeletions, erasureRequests }.
  // Rejects with an Error whose `code` is one of ACCOUNT_FORGETTING_ERRORS.
  // INVALID_USER_ID, INVALID_RECIPIENT and USER_NOT_FOUND record nothing;
  // the other refusals change nothing and record the refusal;
  // ACTIVITIES_NOT_FINISHED and unexpected failures are recorded as failed.
  async function forgetTeacher({
    adminUserId,
    userId,
    expectedEmail = null,
    recipientId = null,
    expectedRecipientEmail = null,
    finishActivities
  }) {
    const teacherId = normalizeUserId(userId);

    if (!teacherId) {
      throw forgettingError(ACCOUNT_FORGETTING_ERRORS.invalidUserId);
    }

    const recipient = recipientId === null || recipientId === undefined ? null : normalizeUserId(recipientId);
    if ((recipientId !== null && recipientId !== undefined && !recipient) || recipient === teacherId) {
      throw forgettingError(ACCOUNT_FORGETTING_ERRORS.invalidRecipient);
    }

    const auditEvent = {
      adminUserId,
      action: ADMIN_AUDIT_ACTIONS.accountForget,
      targetUserId: teacherId,
      targetRole: TEACHER_ROLE
    };
    const checks = { teacherId, expectedEmail, recipientId: recipient, expectedRecipientEmail };
    const accountIds = recipient ? [teacherId, recipient] : [teacherId];

    return audited(auditEvent, async () => {
      const preview = await readAccounts(pool, accountIds);
      if (!preview.has(teacherId)) {
        throw forgettingError(ACCOUNT_FORGETTING_ERRORS.userNotFound);
      }

      const earlyRefusal = teacherRefusal(preview, checks);
      if (earlyRefusal) {
        return refuse(pool, auditEvent, earlyRefusal);
      }

      const finish = await finishActivities();
      if (!finish?.ok) {
        if (finish?.error === 'user_not_found') {
          throw forgettingError(ACCOUNT_FORGETTING_ERRORS.userNotFound);
        }
        if (finish?.error === 'not_a_teacher') {
          return refuse(pool, auditEvent, ACCOUNT_FORGETTING_ERRORS.notATeacher);
        }

        await recordAdminAuditEventBestEffort(pool, {
          ...auditEvent,
          outcome: ADMIN_AUDIT_OUTCOMES.failed,
          reasonCode: ACCOUNT_FORGETTING_ERRORS.activitiesNotFinished
        }, logger);
        throw forgettingError(ACCOUNT_FORGETTING_ERRORS.activitiesNotFinished, {
          audited: true,
          reason: typeof finish?.error === 'string' ? finish.error : 'ethicapp_error',
          failedActivities: Array.isArray(finish?.failed) ? finish.failed.length : 0
        });
      }

      return withTransaction(async (client) => {
        const accounts = await readAccounts(client, accountIds, { lock: true });
        const teacher = accounts.get(teacherId);
        if (!teacher) {
          throw forgettingError(ACCOUNT_FORGETTING_ERRORS.userNotFound);
        }

        const refusal = teacherRefusal(accounts, checks);
        if (refusal) {
          return refuse(client, auditEvent, refusal);
        }

        // The account is locked: from here on the teacher cannot create an
        // activity (the foreign key on sessions.creator waits for the lock),
        // but one may have been started or created since ethicapp finished
        // them. Anonymizing then would leave an activity running under a
        // disabled account, so nothing is done; the administrator retries.
        if (await countOpenActivities(client, teacherId) > 0) {
          return refuse(client, auditEvent, ACCOUNT_FORGETTING_ERRORS.openActivities);
        }

        const runOptions = runOptionsFor(adminUserId, TEACHER_ROLE);
        const runId = await createAnonymizationRun(client, runOptions, 1);
        const materials = await handleTeacherMaterials(client, {
          teacherId,
          recipientId: recipient,
          accountEmail: teacher.mail,
          anonymousEmail: buildAnonymousTeacherIdentity(teacherId).email
        });
        const stepResult = await anonymizeAccountInTransaction(client, runId, { id: teacherId }, runOptions);

        if (stepResult.status !== 'succeeded') {
          throw new Error(`Unexpected anonymization step status: ${stepResult.status}`);
        }

        const caseFiles = await recordUploadDeletionRequests(client, teacherId, runId, materials.fileEntries);

        await finalizeAnonymizationRun(client, runId, { total: 1, succeeded: 1, failed: 0 });
        await recordAdminAuditEvent(client, { ...auditEvent, outcome: ADMIN_AUDIT_OUTCOMES.succeeded });

        return {
          id: teacherId,
          status: ACCOUNT_STATUSES.anonymized,
          runId,
          recipientId: recipient,
          activitiesFinished: Array.isArray(finish.finished) ? finish.finished.length : 0,
          materials: {
            deleted: { cases: materials.deleted.cases, designs: materials.deleted.designs },
            transferred: materials.transferred,
            kept: materials.kept,
            authorEmails: materials.authorEmails
          },
          uploadDeletions: caseFiles + stepResult.counts.profileImageFiles,
          erasureRequests: pendingErasureRequests(stepResult.erasureServiceIds)
        };
      });
    });
  }

  // What forgetting the teacher would do, for the dialog, without changing
  // anything: the open activities ethicapp would finish, and the cases and
  // designs that would be deleted, or kept (transferred to a recipient or
  // left under the anonymized account), and the copies other teachers made.
  //
  // `fetchOpenActivities()` resolves like
  // fetchOpenTeacherActivitiesFromEthicapp. When ethicapp cannot answer,
  // `openActivities` holds { ok: false, error, count } with the count read
  // from the database, so the dialog can warn that forgetting needs ethicapp.
  //
  // Rejects with INVALID_USER_ID, USER_NOT_FOUND, ACCOUNT_ANONYMIZED or
  // NOT_A_TEACHER.
  async function previewTeacherForgetting({ userId, fetchOpenActivities }) {
    const teacherId = normalizeUserId(userId);

    if (!teacherId) {
      throw forgettingError(ACCOUNT_FORGETTING_ERRORS.invalidUserId);
    }

    const client = await pool.connect();
    let counts;
    let databaseOpenActivities;

    try {
      // One snapshot, so the counts add up.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const teacher = (await readAccounts(client, [teacherId])).get(teacherId);

      if (!teacher) {
        throw forgettingError(ACCOUNT_FORGETTING_ERRORS.userNotFound);
      }
      if (teacher.anonymized_at) {
        throw forgettingError(ACCOUNT_FORGETTING_ERRORS.accountAnonymized);
      }
      if (teacher.role !== TEACHER_ROLE) {
        throw forgettingError(ACCOUNT_FORGETTING_ERRORS.notATeacher);
      }

      counts = await previewTeacherMaterials(client, teacherId);
      databaseOpenActivities = await countOpenActivities(client, teacherId);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const open = await fetchOpenActivities();
    const openActivities = open?.ok
      ? { ok: true, count: open.count }
      : {
          ok: false,
          error: typeof open?.error === 'string' ? open.error : 'ethicapp_error',
          count: databaseOpenActivities
        };

    return { userId: teacherId, openActivities, ...counts };
  }

  return { forgetStudent, forgetTeacher, previewTeacherForgetting };
}

const defaultService = createAccountForgettingService();

export const { forgetStudent, forgetTeacher, previewTeacherForgetting } = defaultService;

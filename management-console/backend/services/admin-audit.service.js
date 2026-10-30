// Audit log of administrator actions (admin_audit_events, V27).
//
// A row names the administrator and the target account by id, the action,
// the outcome and, for a refusal or a failure, an upper-case reason code. It
// never carries personal data: no names, emails or free text.
//
// Record an event inside the action's transaction when the action succeeds
// or is refused, so the row and the change commit together. When the action
// fails and its transaction is rolled back, record the failure on its own
// with recordAdminAuditEventBestEffort.

// Audited actions. The database checks only the format
// (`<area>.<verb>`), so a new action needs no migration: add it here.
export const ADMIN_AUDIT_ACTIONS = Object.freeze({
  accountConfirm: 'account.confirm',
  accountDelete: 'account.delete'
});

export const ADMIN_AUDIT_OUTCOMES = Object.freeze({
  succeeded: 'succeeded',
  refused: 'refused',
  failed: 'failed'
});

const KNOWN_ACTIONS = new Set(Object.values(ADMIN_AUDIT_ACTIONS));
const KNOWN_OUTCOMES = new Set(Object.values(ADMIN_AUDIT_OUTCOMES));
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const REASON_CODE_MAX_LENGTH = 64;

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

// Validates an event and returns the INSERT parameters. Throws a TypeError
// for a programming error (unknown action or outcome, invalid ids or reason
// code), so a wrong call never writes a malformed row.
export function buildAdminAuditEventParams({
  adminUserId,
  action,
  targetUserId = null,
  outcome,
  reasonCode = null
} = {}) {
  const normalizedAdminUserId = Number(adminUserId);
  const normalizedTargetUserId = targetUserId === null || targetUserId === undefined
    ? null
    : Number(targetUserId);

  if (!isPositiveInteger(normalizedAdminUserId)) {
    throw new TypeError('Admin audit event needs a positive integer adminUserId');
  }

  if (normalizedTargetUserId !== null && !isPositiveInteger(normalizedTargetUserId)) {
    throw new TypeError('Admin audit event targetUserId must be null or a positive integer');
  }

  if (!KNOWN_ACTIONS.has(action)) {
    throw new TypeError(`Unknown admin audit action: ${action}`);
  }

  if (!KNOWN_OUTCOMES.has(outcome)) {
    throw new TypeError(`Unknown admin audit outcome: ${outcome}`);
  }

  if (
    reasonCode !== null &&
    (typeof reasonCode !== 'string' ||
      reasonCode.length > REASON_CODE_MAX_LENGTH ||
      !REASON_CODE_PATTERN.test(reasonCode))
  ) {
    throw new TypeError('Admin audit reasonCode must be an upper-case code');
  }

  return [normalizedAdminUserId, action, normalizedTargetUserId, outcome, reasonCode];
}

// Inserts one event. `executor` is anything with `query(text, params)`: a
// transaction client, to record the event with the action, or the pool.
// Resolves to { id, occurredAt }.
export async function recordAdminAuditEvent(executor, event) {
  const params = buildAdminAuditEventParams(event);
  const result = await executor.query(
    `
      INSERT INTO admin_audit_events
        (admin_user_id, action, target_user_id, outcome, reason_code)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, occurred_at
    `,
    params
  );
  const row = result.rows[0];

  return {
    id: Number(row.id),
    occurredAt: row.occurred_at
  };
}

// Records an event without ever throwing, for a failure reported after its
// transaction was rolled back: the original error is what the caller must
// rethrow. Resolves to the recorded event, or null when recording failed.
export async function recordAdminAuditEventBestEffort(executor, event, logger = console) {
  try {
    return await recordAdminAuditEvent(executor, event);
  } catch (error) {
    logger.error('Unable to record admin audit event', {
      action: event?.action,
      outcome: event?.outcome,
      error: error?.message
    });
    return null;
  }
}

-- Audit log of administrator actions in the management console (epic #879,
-- sub-issue #874).
--
-- Design notes:
--
-- One row per attempt of an audited action, written by the management
-- console in the same transaction as the action when it succeeds or is
-- refused, and on its own when the action fails. The first action is
-- account.confirm (#874); deleting a never-activated account (#875) and
-- forgetting a student or a teacher (#876, #877) reuse the table.
--
-- No personal data is copied: the row names the administrator and the
-- target account by id only, and reason_code is restricted to an upper-case
-- code (ACCOUNT_NOT_PENDING, for example), so no free text can carry a name
-- or an email.
--
-- admin_user_id and target_user_id have no foreign key on purpose: the
-- audit trail must outlive the accounts it names, including an account that
-- is deleted (#875). Action names are checked by format rather than listed,
-- so a later action needs no migration; the console keeps the list.
--
-- The table is append-only, like ai_service_policy_versions (V22). A
-- retention policy, when one is decided, needs a migration of its own.

CREATE TABLE IF NOT EXISTS admin_audit_events (
    id bigserial PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    admin_user_id integer NOT NULL,
    action varchar(64) NOT NULL,
    target_user_id integer,
    outcome varchar(16) NOT NULL,
    reason_code varchar(64),
    CONSTRAINT admin_audit_events_action_check
    CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
    CONSTRAINT admin_audit_events_outcome_check
    CHECK (outcome IN ('succeeded', 'refused', 'failed')),
    CONSTRAINT admin_audit_events_reason_code_check
    CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]*$'),
    CONSTRAINT admin_audit_events_user_ids_check
    CHECK (admin_user_id > 0 AND (target_user_id IS NULL OR target_user_id > 0))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_events_occurred_at
ON admin_audit_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_events_target_user
ON admin_audit_events (target_user_id, occurred_at DESC)
WHERE target_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_admin_audit_event_change()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'admin_audit_events is append-only: % is not allowed.', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_audit_events_append_only
ON admin_audit_events;
CREATE TRIGGER admin_audit_events_append_only
BEFORE UPDATE OR DELETE
ON admin_audit_events
FOR EACH ROW
EXECUTE FUNCTION reject_admin_audit_event_change();

DROP TRIGGER IF EXISTS admin_audit_events_no_truncate
ON admin_audit_events;
CREATE TRIGGER admin_audit_events_no_truncate
BEFORE TRUNCATE
ON admin_audit_events
FOR EACH STATEMENT
EXECUTE FUNCTION reject_admin_audit_event_change();

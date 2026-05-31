# Student Anonymization Data Map

This document records the student-linked personal data fields reviewed for the
scheduled anonymization process. It is intended to support privacy reviews and
to keep the operational job aligned with the schema.

The anonymization job is owned by `management-console` because it is a platform
administration task. Legacy EthicApp remains the passive owner of several
affected pedagogical tables.

## Manual Inventory Query

Run this query against PostgreSQL to list tables that reference `users` and the
candidate text-like columns in those tables:

```sql
WITH user_refs AS (
    SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'users'
),
text_columns AS (
    SELECT
        table_schema,
        table_name,
        string_agg(
            column_name || ' ' || data_type,
            ', '
            ORDER BY ordinal_position
        ) AS text_columns
    FROM information_schema.columns
    WHERE data_type IN (
        'text',
        'character varying',
        'character',
        'inet',
        'jsonb'
    )
    GROUP BY table_schema, table_name
)
SELECT
    ur.table_name,
    string_agg(ur.column_name, ', ' ORDER BY ur.column_name) AS user_ref_columns,
    tc.text_columns
FROM user_refs ur
LEFT JOIN text_columns tc
  ON tc.table_schema = ur.table_schema
 AND tc.table_name = ur.table_name
GROUP BY ur.table_name, tc.text_columns
ORDER BY ur.table_name;
```

## Coverage Decisions

| Table and fields | Production reachability | Decision | Current coverage |
| --- | --- | --- | --- |
| `users.name`, `users.firstname`, `users.lastname`, `users.mail`, `users.rut` | Core account profile for student login and activity membership. | In scope. Replace with deterministic anonymous values. | Covered by the job. |
| `users.pass`, `users.password_bcrypt`, `users.active`, `users.email_confirmed`, `users.session_version`, `users.anonymized_at`, `users.anonymization_run_id` | Core account and session state. | In scope. Disable account, clear credentials, invalidate sessions, and mark run metadata. | Covered by the job. |
| `users.sex`, `users.last_login_at` | Demographic and activity metadata. | In scope. Clear during anonymization. | Covered by the job. |
| `users.profile_image_path`, `users.profile_image_topbar_path` | Teacher/student profile image references served through protected uploads. | In scope for database references. Null stored paths. | Covered by the job. File deletion is tracked separately. |
| `differential_selection.comment` | Active semantic-differential student justification text. | In scope. Replace free text with the placeholder. | Covered by the job. |
| `differential_chat.content` | Active semantic-differential group chat text. | In scope. Replace free text with the placeholder. | Covered by the job. |
| `chat.content` | Active ranking and group chat text through `group-messages` and student session views. | In scope. Replace free text with the placeholder. | Covered by the job. |
| `actor_selection.description` | Active role/actor selection justification text through phase and activity routes. | In scope. Replace free text with the placeholder. | Covered by the job. |
| `sesusers.device` | Session join metadata supplied by student clients. | In scope. Clear because it can identify a device or client context. | Covered by the job. |
| `pass_reset.mail`, `pass_reset.token` | Password reset records keyed by email. | In scope. Delete rows for the original student email before changing it. | Covered by the job. |
| `teamusers.uid`, `teamusers.anon_mask` | Pedagogical membership and anonymous display mask. | Retain. No free-text data; the FK points to an anonymized inactive user. | No action needed. |
| `jigsaw_users.userid` | Pedagogical role assignment. | Retain. No free-text data; the FK points to an anonymized inactive user. | No action needed. |
| `activity_report_exports.actor_user_id`, `activity_report_exports.effective_user_id`, `activity_report_exports.ip_address`, `activity_report_exports.user_agent`, `activity_report_exports.content_sha256`, `activity_report_exports.metadata` | Audit trail for report export actions. Current production flows are teacher/admin export operations, not student-generated answers. | Out of first student anonymization job. Requires a separate audit-retention policy if operator metadata minimization is desired. | Not covered by the job. |
| `user_passkeys.*` | WebAuthn credentials for management-console administrator users. | Out of scope. The table is not used for students. | Not covered by the job. Revisit if student passkeys are introduced. |

## Remaining Follow-Ups

- Issue #552: purge orphaned profile image files after database paths are nulled, if the
  deployment's storage-minimization policy requires physical deletion from the
  uploads volume.
- Issue #553: define a separate retention/minimization policy for
  `activity_report_exports`, because those rows are audit records for report
  exports and include operator/network metadata rather than student-generated
  response text.

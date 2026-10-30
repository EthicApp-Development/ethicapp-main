# Student Anonymization Data Map

This document records the student-linked personal data fields reviewed for the
scheduled anonymization process and for forgetting a student on demand from
the management console (#876), which run the same per-account step. It is
intended to support privacy reviews and to keep the operational job aligned
with the schema.

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

The same inventory, with each foreign key's `ON DELETE` rule and the user id
columns that have no foreign key, is kept as code in
`management-console/backend/services/user-references.js`. The deletion of a
never-activated account uses it to refuse accounts that any table still
references, and its integration test fails when a migration adds a reference
to `users` that the list does not name.

## Coverage Decisions

| Table and fields | Production reachability | Decision | Current coverage |
| --- | --- | --- | --- |
| `users.name`, `users.firstname`, `users.lastname`, `users.mail`, `users.rut` | Core account profile for student login and activity membership. | In scope. Replace with deterministic anonymous values. | Covered by the job. |
| `users.pass`, `users.password_bcrypt`, `users.active`, `users.email_confirmed`, `users.session_version`, `users.anonymized_at`, `users.anonymization_run_id` | Core account and session state. | In scope. Disable account, clear credentials, invalidate sessions, and mark run metadata. | Covered by the job. |
| `users.sex`, `users.last_login_at` | Demographic and activity metadata. | In scope. Clear during anonymization. | Covered by the job. |
| `users.profile_image_path`, `users.profile_image_topbar_path` | Teacher/student profile image references served through protected uploads. | In scope for database references. Null stored paths. | Covered by the job. File deletion is tracked separately. |
| `users.created_at` | Account creation time (V28); NULL for accounts created before it was recorded. | Retain. It does not identify anyone and keeps the account's age for audits. | No action needed. |
| `differential_selection.comment` | Active semantic-differential student justification text. | In scope. Replace free text with the placeholder. | Covered by the job. |
| `differential_chat.content` | Active semantic-differential group chat text. | In scope. Replace free text with the placeholder. | Covered by the job. |
| `chat.content` | Active ranking and group chat text through `group-messages` and student session views. | In scope. Replace free text with the placeholder. | Covered by the job. |
| `actor_selection.description` | Active role/actor selection justification text through phase and activity routes. | In scope. Replace free text with the placeholder. | Covered by the job. |
| `sesusers.device` | Session join metadata supplied by student clients. | In scope. Clear because it can identify a device or client context. | Covered by the job. |
| `external_service_results.raw_payload`, `sanitized_payload`, `adapter_result` (rows with the student's `user_id`) | AI service callbacks correlated to the student's work. See "AI service payload inventory". | In scope. Replace every string with the placeholder; keep the structure, numbers and rows. | Covered by the job (#876). Callbacks that arrive later are written with their strings already replaced (V31 triggers). |
| `external_service_jobs.outbound_payload` (rows with the student's `user_id`) | Never set by the current adapters (always NULL). | In scope should it ever be set. Same replacement. | Covered by the job (#876), and by the V31 triggers for later writes. |
| `external_service_jobs`, `external_service_results`: `user_id`, `group_id` and the other ids | Destination of AI service work. | Retain. Ids only; the user id points to the anonymized account. | No action needed. |
| `external_service_jobs.instantiation_report`, `provider_reference` | Session-creation reports of the tutor and Polyadic, and Polyadic room names made of ids. | Retain. They carry case text and settings, no student text. | No action needed. |
| Argumentation Tutor (AI Additions): sessions, history, task keys and Celery results in Redis | The student's arguments and the tutor's analyses, for 24 hours. | In scope. Erased by `DELETE /argumentation-tutor/api/v2/users/{id}/data`. | Erasure request recorded by the job; sent by ethicapp in the background (#876). |
| Polyadic Agents (AI Additions): `messages` | The student's chat messages, with no expiry; agent replies that name or quote them. | In scope. Erased and redacted by `DELETE /polyadic-agent/api/participants/{id}/data`. | Erasure request recorded by the job; sent by ethicapp (#876). Messages forwarded before #876 carry no `participant_id` and are not found. |
| `chat.content`, `differential_chat.content` of external agent rows; room-level Polyadic results (`user_id` NULL) | Agent replies in the group chat, which can quote a student. | Retain for now. Other students' views and the chat stay consistent; finding a student's words in other rows needs a fragment matcher like Polyadic's. | Not covered. Known limitation (#876). |
| `user_erasure_requests` | One row per anonymized account and AI Additions service (V31): ids, status, attempts, an upper-case error code. | Retain. No personal data; it is the record that AI Additions was asked to forget the account. | No action needed. |
| `pass_reset.mail`, `pass_reset.token` | Password reset records keyed by email. | In scope. Delete rows for the original student email before changing it. | Covered by the job. |
| `teamusers.uid`, `teamusers.anon_mask` | Pedagogical membership and anonymous display mask. | Retain. No free-text data; the FK points to an anonymized inactive user. | No action needed. |
| `jigsaw_users.userid` | Pedagogical role assignment. | Retain. No free-text data; the FK points to an anonymized inactive user. | No action needed. |
| `activity_report_exports.actor_user_id`, `activity_report_exports.effective_user_id`, `activity_report_exports.ip_address`, `activity_report_exports.user_agent`, `activity_report_exports.content_sha256`, `activity_report_exports.metadata` | Audit trail for report export actions. Current production flows are teacher/admin export operations, not student-generated answers. | Out of first student anonymization job. Requires a separate audit-retention policy if operator metadata minimization is desired. | Not covered by the job. |
| `user_passkeys.*` | WebAuthn credentials for management-console administrator users. | Out of scope. The table is not used for students. | Not covered by the job. Revisit if student passkeys are introduced. |

## AI Service Payload Inventory

What the AI service tables can hold about a student, per service, reviewed for
#876. All writes go through `ethicapp/backend/services/external-service-jobs.service.js`
and `external-service-room-jobs.service.js`.

Where the rows get a `user_id`:

- `student-response-submitted` jobs (tutor) carry the student; their callback
  results inherit it from the job.
- `chat-message-received` jobs (Polyadic) carry the sender; a Polyadic
  callback correlated to such a job inherits it.
- Polyadic room jobs and the callbacks correlated to them have no `user_id`,
  only the group; callbacks that match no job have no destination ids at all.
- Case and design analysis jobs carry the teacher.

Columns:

| Column | Argumentation Tutor (`argumentation-tutor-system`) | Polyadic Agents (`polyadic-devils-advocate`) |
| --- | --- | --- |
| `external_service_jobs.outbound_payload` | Always NULL. | Always NULL. |
| `external_service_results.raw_payload` | The callback's `payload`, stored whole: `argumentPreview` or `submitted_argument` (the student's argument verbatim), `comparison.initialArgument` and `comparison.revisedArgument`, the tutor's `summary`, `bullets[]`, `message`, `criteria[].value`, `claimTypeRationale` and `unsupportedClaims[].statement`, which can quote the student; ids and scores. | `{ room, evaluations: [{ agente, respuesta }] }`: agent replies that can quote students or name them by the name Polyadic was given (a first name or the anonymous mask). |
| `external_service_results.sanitized_payload` | Never written. | Never written. |
| `external_service_results.adapter_result` | `payload.claimTypeRationale` and `payload.unsupportedClaims[].statement` (paraphrases of the student's claims), `feedbackTitle`, ids; `{ status, error }` on failure. | Counts and the room name; no text. |

The per-account step replaces every string in those columns, for the rows with
the student's `user_id`, so it does not depend on this inventory staying
complete. An AI service can still deliver a callback for work it received
before the student was forgotten. Triggers from V31 replace the strings of any
payload later written for an anonymized user in the same way, with the
placeholder of the run that anonymized the account. A write that races with
the step either waits for it or is rewritten by it, as V31 explains. The feedback the tutor sends to the student is published over the
socket only, never stored.

## Container Logs

The external-services path logs only ids, the service, the hook, statuses,
counts and sizes (#876, `ethicapp/backend/helpers/log-safety.js`): never
callback payloads, adapter results or AI Additions error bodies.

Before #876, ethicapp logged each callback result whole, and some errors with
the AI service's response body attached. The ethicapp container logs written
by earlier releases may therefore hold students' text or the tutor's
paraphrases of it (`claimTypeRationale`, `unsupportedClaims`), which
anonymizing or forgetting a student does not reach. Operators rotate and
expire container logs under their log retention policy; after deploying
#876, logs from before the deployment should not be kept beyond it.

## Remaining Follow-Ups

- Issue #552: purge orphaned profile image files after database paths are nulled, if the
  deployment's storage-minimization policy requires physical deletion from the
  uploads volume.
- Issue #553: define a separate retention/minimization policy for
  `activity_report_exports`, because those rows are audit records for report
  exports and include operator/network metadata rather than student-generated
  response text.

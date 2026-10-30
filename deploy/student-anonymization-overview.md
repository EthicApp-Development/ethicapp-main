# Student Anonymization Capability Overview

This document explains the repository-owned pieces that make periodic student
data anonymization possible. It complements the operator runbook in
`deploy/student-anonymization-maintenance-runbook.md` and the field-level data
map in `deploy/student-anonymization-data-map.md`.

## Goal

EthicApp installations must be able to periodically anonymize student accounts
and student-generated response data. The expected cadence is twice per year,
but calendar enforcement is intentionally delegated to the deployment scheduler
so each installation can choose its own maintenance windows.

An administrator can also make EthicApp forget one student at any time, from
the student's page in the management console (#876). The same per-account
step runs, online and without a maintenance window (see "Forgetting a student
on demand").

After a student account is anonymized:

- The account is disabled.
- Existing browser sessions are invalidated through `users.session_version`.
- The student cannot log in with the old credentials.
- The student must create a new account if they need to use EthicApp again.
- Pedagogical relationships remain available through an inactive, anonymized
  user record so activity history stays structurally consistent.

## Implemented Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Audit schema | `database/migrations/V12__student_anonymization_audit.sql` | Adds run/event audit tables and user anonymization metadata. |
| Anonymization job | `management-console/backend/scripts/anonymize-students.js` and `management-console/backend/helpers/student-anonymization-helper.js` | Selects eligible students, anonymizes account and response data, logs per-account outcomes, and supports dry runs. |
| One-shot runtime role | `management-console/docker-entrypoint.sh` and deployment env `MNG_PROCESS_ROLE=student-anonymization` | Lets the management-console image run as a one-shot anonymization process instead of the web app. |
| Compose job service | `management-console-student-anonymization` in `docker-compose.yml` | Development and maintenance service for running the anonymization job. |
| Maintenance mode | `nginx/conf.d/maintenance.conf.template`, `nginx/static/maintenance/index.html`, and `nginx/docker-entrypoint.d/40-select-maintenance-config.sh` | Serves a static `503` maintenance page while app services are stopped. |
| Maintenance script | `scripts/student-anonymization-maintenance.sh` | Coordinates preflight, maintenance mode, dry-run, real execution, post-checks, and restore for Compose-based deployments. |
| Deployment contract | `deploy/env.contract.yml` | Documents runtime variables used by NGINX, management-console, and the anonymization job. |
| Operator runbook | `deploy/student-anonymization-maintenance-runbook.md` | Step-by-step execution procedure for operators. |
| Data map | `deploy/student-anonymization-data-map.md` | Documents reviewed fields, coverage decisions, exclusions, and follow-up items. |
| On-demand forgetting | `management-console/backend/services/account-forgetting.service.js`, `routes/user-forgetting.routes.js`, and the user page | `POST /mng/api/users/:id/forget` runs the per-account step for one student in one transaction (#876). |
| AI service data step | `management-console/backend/helpers/student-ai-service-data-helper.js` | Erases the strings in the student's AI service payloads and records the AI Additions erasure requests, inside the per-account step. |
| Erasure requests | `database/migrations/V31__user_erasure_requests.sql` (`user_erasure_requests`) | One row per anonymized account and AI Additions service, with its status, attempts and last error. |
| Erasure processor | `ethicapp/backend/services/user-erasure/` and the `user-forgotten` hook of the tutor and Polyadic adapters | ethicapp sends the requests in the background, with retries, and serves their status and a retry to the console (`/api/admin/user-erasure/`, internal only). |

## Ownership Model

The anonymization process is owned by `management-console` because it is a
platform administration workflow. Legacy `ethicapp` owns several affected
pedagogical tables, but it does not own the maintenance process. This keeps the
operational control plane in the management application while preserving the
existing data model.

## Data Coverage

The current job anonymizes or clears:

- Account identity fields: `users.name`, `users.firstname`, `users.lastname`,
  `users.mail`, `users.rut`.
- Account access fields: `users.pass`, `users.password_bcrypt`,
  `users.active`, `users.email_confirmed`, `users.session_version`,
  `users.anonymized_at`, `users.anonymization_run_id`.
- Account metadata: `users.sex`, `users.last_login_at`,
  `users.profile_image_path`, `users.profile_image_topbar_path`.
- Student free-text fields: `differential_selection.comment`,
  `differential_chat.content`, `chat.content`,
  `actor_selection.description`.
- AI service payloads of the student's work: every string in
  `external_service_results.raw_payload`, `sanitized_payload` and
  `adapter_result`, and in `external_service_jobs.outbound_payload`, for the
  rows with the student's `user_id`, is replaced with the placeholder. The
  structure, numbers and the rows are kept.
- AI Additions: one pending erasure request per service (Argumentation Tutor,
  Polyadic Agents) in `user_erasure_requests`, which ethicapp sends in the
  background (see "Erasure in AI Additions").
- Student client metadata: `sesusers.device`.
- Reset records for the original email: `pass_reset`.

The current job intentionally retains relationship rows such as `teamusers` and
`jigsaw_users` because they contain no free-text data and point to the
anonymized inactive user. It also keeps `users.created_at`, which does not
identify anyone and keeps the account's age for audits. See `deploy/student-anonymization-data-map.md` for
the field-by-field rationale and the manual inventory query.

## Audit Model

Each job creates one row in `student_anonymization_runs`. Each processed
account creates or updates one row in `student_anonymization_events`.

Run statuses:

- `running`
- `completed`
- `completed_with_failures`
- `failed`

Event statuses:

- `started`
- `skipped`
- `succeeded`
- `failed`

The job logs progress in the form `anonymizing account x of total` and records
per-account row counts for the data areas it changes. Failed accounts are
logged individually and do not prevent later candidates from being attempted.

## Forgetting a student on demand

`POST /mng/api/users/:id/forget` (role `S` in the console, after the step-up
confirmation, with the email the administrator approved) forgets one student.
It refuses teachers, administrators and anonymized accounts, and an account
whose email changed since the page was loaded. In one transaction it:

1. locks the account and checks it;
2. creates a run of one account in `student_anonymization_runs`, with
   `triggered_by = admin-user:<id>` and `process_name = mng-console`;
3. runs the same per-account step as the scheduled job (account, written
   responses, AI service payloads, erasure requests), with the same
   placeholder (`STUDENT_ANONYMIZATION_PLACEHOLDER_TEXT`);
4. finalizes the run and records `account.forget` in `admin_audit_events`.

The administrator gets the answer once it commits: the student is disabled
and anonymized by then, and the next request of any of their sessions is
refused (`session_version` and `active = false`). An already open Socket.IO
connection is only checked at its handshake; it can stay open until the
student's next HTTP request or reconnection, and its writes are refused.

No maintenance window is needed for one account. The window remains an
operational precaution for the bulk job.

## Erasure in AI Additions

AI Additions keeps what students sent to the tutor (sessions and history in
Redis, for 24 hours) and to Polyadic Agents (messages with no expiry). The
per-account step records one `pending` request per service in
`user_erasure_requests`; ethicapp, which holds the AI Additions credentials,
sends them:

- Every 30 seconds, a processor in the ethicapp web process claims the due
  requests (a lease of five minutes, `FOR UPDATE SKIP LOCKED`, so several
  ethicapp processes never send the same request at once) and dispatches the
  `user-forgotten` global hook to the adapters of the request's service: the
  tutor adapter calls `DELETE /argumentation-tutor/api/v2/users/{id}/data`,
  the Polyadic adapter `DELETE /polyadic-agent/api/participants/{id}/data`.
  Both are idempotent.
- A confirmed erasure marks the request `done`. A failure a retry can fix
  (the service unreachable, a timeout, an error status other than 400 or 422,
  no AI Additions connection) keeps it `pending` with the next attempt after
  1, 2, 4, ... minutes, up to six hours, and it never gives up. A refusal a
  retry cannot fix marks it `failed`.
- The state lives only in the database, so the processing survives restarts.
  A request whose attempt was cut short is due again when its lease ends.
- Erasure hooks skip the AI service policy: a service the current policy
  switched off may still hold data from when it was allowed. They still need
  the AI Additions connection.
- The console's user page shows, for an anonymized account,
  "EthicApp ✓ · Tutor ✓ · Polyadic: retrying" and offers a retry, which
  resets the requests that are not done and sends them at once
  (`account.erasure_retry` in the audit log).

The scheduled job runs while ethicapp is stopped, so its requests wait,
`pending`, until ethicapp starts again. A failing AI service never blocks or
reverts the anonymization in EthicApp.

Polyadic finds a participant's messages by `participant_id`, the EthicApp user
id that the adapter sends with each forwarded message since #876. Messages
forwarded before carry only a display name, and its erasure cannot find them.

## Runtime Configuration

Deployment repositories should consume `deploy/env.contract.yml` from the same
release tag as the deployed images. The key variables for this capability are:

| Variable | Purpose |
| --- | --- |
| `STUDENT_ANONYMIZATION_WINDOW_SCHEDULE` | Operator/scheduler metadata for planned window dates. Defaults to `01-01,07-01` but should be configured before deployment. |
| `STUDENT_ANONYMIZATION_WINDOW_TIMEZONE` | Timezone used by the operator or scheduler for those dates. |
| `STUDENT_ANONYMIZATION_DRY_RUN` | Runs the job without modifying account or response data. |
| `STUDENT_ANONYMIZATION_PLACEHOLDER_TEXT` | Replacement text for student free-text fields and AI service payloads. Defaults to `******`. The management console reads it too, for forgetting on demand; keep the same value in both services. |
| `STUDENT_ANONYMIZATION_TRIGGERED_BY` | Operator or scheduler label stored in the run audit row. |
| `STUDENT_ANONYMIZATION_PROCESS_NAME` | Process name stored in the run audit row. |
| `MNG_PROCESS_ROLE` | Use `student-anonymization` to run the management-console image as the one-shot job. |
| `NGINX_MAINTENANCE_MODE` | Use `true` to serve maintenance responses instead of proxying to apps. |
| `NGINX_MAINTENANCE_RETRY_AFTER` | Value emitted in the maintenance `Retry-After` header. |

The schedule variables are metadata only. The repository script does not
enforce calendar dates; production deployments should use their scheduler of
choice, such as a deployment repository workflow, Kubernetes CronJob, systemd
timer, or an operator-managed calendar.

## Operational Flow

1. Schedule the maintenance window in the deployment platform.
2. Run preflight:
   - ensure PostgreSQL is reachable,
   - validate Flyway state,
   - count eligible student accounts,
   - review configured schedule metadata.
3. Stop application services:
   - `ethicapp`,
   - `ethicapp-student`,
   - `auth-backend`,
   - `management-console`.
4. Start NGINX with `NGINX_MAINTENANCE_MODE=true`.
5. Run the anonymization job with `STUDENT_ANONYMIZATION_DRY_RUN=true`.
6. Review dry-run output and recent audit rows.
7. Run the real job with `CONFIRM_STUDENT_ANONYMIZATION=true`.
8. Review `student_anonymization_runs` and `student_anonymization_events`.
9. Restore application services.
10. Restart NGINX with `NGINX_MAINTENANCE_MODE=false`.

The Compose helper script exposes this flow through:

```bash
npm run anonymization:maintenance -- preflight
npm run anonymization:maintenance -- dry-run
CONFIRM_STUDENT_ANONYMIZATION=true npm run anonymization:maintenance -- execute
npm run anonymization:maintenance -- post-check
npm run anonymization:maintenance -- restore
```

## Safety Properties

- The real execution path requires `CONFIRM_STUDENT_ANONYMIZATION=true`.
- Dry-run mode records skipped audit events and avoids data changes.
- Candidate selection excludes accounts where `users.anonymized_at IS NOT NULL`.
- Each account is processed in its own transaction.
- The account row is locked before mutation.
- Account credentials are cleared and the account is deactivated.
- `users.session_version` is incremented so existing sessions are revoked.
- The maintenance runbook stops public app services before the destructive job
  runs.
- NGINX maintenance mode returns `503` for public app routes and leaves health
  checks available.

## Verification

Development verification should include:

- `npm run db:migrate` or `npm run db:validate` for the schema state.
- Focused management-console backend tests for the helper.
- `npm test` in `management-console/backend`.
- A dry-run maintenance execution.
- A real execution in disposable/local data.
- SQL review of `student_anonymization_runs` and
  `student_anonymization_events`.
- SQL review of eligible students:

```sql
SELECT count(*)
FROM users
WHERE role = 'A'
  AND anonymized_at IS NULL;
```

Production verification should follow the runbook and capture the final run id,
run status, failed account count, and restoration checks.

## Known Follow-Ups

- Issue #552 tracks optional physical deletion of orphaned student profile
  image files after database paths are nulled.
- Issue #553 tracks a separate retention/minimization policy for
  `activity_report_exports` audit metadata.
- Agent replies that EthicApp stores in the group chat (`chat` and
  `differential_chat` rows of an external agent, and room-level Polyadic
  callback results without a `user_id`) can quote a forgotten student. They
  are kept: Polyadic redacts its own copy, but EthicApp does not search other
  rows for the student's words.


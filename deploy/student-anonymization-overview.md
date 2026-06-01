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
- Student client metadata: `sesusers.device`.
- Reset records for the original email: `pass_reset`.

The current job intentionally retains relationship rows such as `teamusers` and
`jigsaw_users` because they contain no free-text data and point to the
anonymized inactive user. See `deploy/student-anonymization-data-map.md` for
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

## Runtime Configuration

Deployment repositories should consume `deploy/env.contract.yml` from the same
release tag as the deployed images. The key variables for this capability are:

| Variable | Purpose |
| --- | --- |
| `STUDENT_ANONYMIZATION_WINDOW_SCHEDULE` | Operator/scheduler metadata for planned window dates. Defaults to `01-01,07-01` but should be configured before deployment. |
| `STUDENT_ANONYMIZATION_WINDOW_TIMEZONE` | Timezone used by the operator or scheduler for those dates. |
| `STUDENT_ANONYMIZATION_DRY_RUN` | Runs the job without modifying account or response data. |
| `STUDENT_ANONYMIZATION_PLACEHOLDER_TEXT` | Replacement text for student free-text fields. Defaults to `******`. |
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


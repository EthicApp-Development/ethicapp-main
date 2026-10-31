# Student Anonymization Maintenance Runbook

This runbook is the repository-owned command contract for the student
anonymization maintenance window.

The capability overview is maintained in
`deploy/student-anonymization-overview.md`.

The field-level coverage map is maintained in
`deploy/student-anonymization-data-map.md`.

The intended recurring windows are January 1 and July 1, but deployments must
not hard-code those dates in this repository. Operators or deployment
repositories should configure the actual schedule before deployment with:

```bash
STUDENT_ANONYMIZATION_WINDOW_SCHEDULE=01-01,07-01
STUDENT_ANONYMIZATION_WINDOW_TIMEZONE=Europe/Madrid
```

Use a deployment-local timezone when the installation has a single operational
timezone. Use an explicit IANA timezone, such as `Europe/Madrid` or
`America/Santiago`, when the scheduler supports it.

After anonymization, affected students must create new accounts if they need to
use EthicApp again.

## Services

During the window:

- Stop: `ethicapp`, `ethicapp-student`, `auth-backend`, `management-console`.
- Keep running: PostgreSQL and Flyway as needed for checks.
- Start or keep: `nginx` in maintenance mode.
- Run: `management-console-student-anonymization`.
- Restore: application services and normal NGINX mode.

## Configuration

Common variables:

```bash
STUDENT_ANONYMIZATION_WINDOW_SCHEDULE=01-01,07-01
STUDENT_ANONYMIZATION_WINDOW_TIMEZONE=Europe/Madrid
STUDENT_ANONYMIZATION_WINDOW_LABEL=2026-07-01
STUDENT_ANONYMIZATION_TRIGGERED_BY=scheduled-maintenance
NGINX_MAINTENANCE_RETRY_AFTER=3600
```

The schedule variables are metadata for operators and deployment schedulers.
The script does not enforce calendar dates, because production scheduling may
live in a deployment repository, Kubernetes CronJob, systemd timer, or another
operator platform.

## Preflight

Run preflight before the maintenance window:

```bash
scripts/student-anonymization-maintenance.sh preflight
```

Preflight checks:

- PostgreSQL can be reached.
- Flyway validation passes.
- The count of non-anonymized student accounts is displayed.
- The configured maintenance schedule and timezone are printed.

If preflight fails, do not enter maintenance. Fix the failing dependency and run
preflight again.

## Dry Run

Run the dry run at the start of the maintenance window:

```bash
STUDENT_ANONYMIZATION_WINDOW_LABEL=2026-07-01 \
scripts/student-anonymization-maintenance.sh dry-run
```

This command:

- Runs preflight.
- Stops application services.
- Starts NGINX in maintenance mode.
- Runs the anonymization job with `STUDENT_ANONYMIZATION_DRY_RUN=true`.
- Prints recent anonymization run rows.

Verify that public app routes return the maintenance page:

```bash
curl -i http://localhost/
curl -i http://localhost/student/
curl -i http://localhost/mng/
curl -i http://localhost/auth/login
curl -i http://localhost/healthz
curl -i http://localhost/readyz
```

Expected results:

- App routes return `503 Service Unavailable` and the maintenance page.
- `/healthz` and `/readyz` return `200` with `maintenance`.

## Real Run

Only run the real anonymization after reviewing the dry-run output.

```bash
CONFIRM_STUDENT_ANONYMIZATION=true \
STUDENT_ANONYMIZATION_WINDOW_LABEL=2026-07-01 \
scripts/student-anonymization-maintenance.sh execute
```

The confirmation variable is required to avoid accidental destructive
execution. The real run anonymizes eligible student accounts, deactivates them,
invalidates sessions through `session_version`, anonymizes current free-text
student responses, the strings in their AI service payloads and
student-provided device metadata, and writes audit rows.

For each anonymized account it also records one pending erasure request per
AI Additions service (`user_erasure_requests`, V31). ethicapp is stopped
during the window, so nothing is sent then: ethicapp sends the requests in the
background after the restore (see "Restore").

## Post-Run Checks

The `execute` command prints recent run rows automatically. You can repeat
post-run checks with:

```bash
scripts/student-anonymization-maintenance.sh post-check
```

Confirm:

- The latest non-dry-run has status `completed`.
- `failed_accounts` is `0`.
- Remaining eligible student count matches expectations.
- No application service is unintentionally exposed while NGINX is still in
  maintenance mode.

If the latest run has `completed_with_failures` or `failed`, keep maintenance
mode enabled, inspect `student_anonymization_events`, and decide whether to
retry after fixing the error.

## Restore

Restore normal service after successful checks:

```bash
scripts/student-anonymization-maintenance.sh restore
```

Confirm:

- Application services are running.
- NGINX validates with `nginx -t`.
- `NGINX_MAINTENANCE_MODE=false` is used for the restored NGINX process.
- Users can reach the normal login page.

Once ethicapp is running, it sends the run's erasure requests to the AI
Additions services within a minute, a few at a time. Follow them with:

```sql
SELECT service_id, status, count(*), max(attempts), max(last_error)
FROM user_erasure_requests
WHERE anonymization_run_id = <run id>
GROUP BY service_id, status;
```

All of them should end `done`. A request that stays `pending` with attempts
is being retried, with a backoff of up to six hours, while its service is
unavailable or the AI Additions connection is missing; it needs no action.
A `failed` request was refused in a way a retry cannot fix (its
`last_error` says why); after fixing the cause, retry it from the student's
page in the management console. The application does not wait for these
requests, and they do not block the restore.

Students with a profile image also leave file deletions
(`upload_deletion_requests`, V32), which ethicapp processes the same way:

```sql
SELECT status, count(*), max(attempts), max(last_error)
FROM upload_deletion_requests
WHERE anonymization_run_id = <run id>
GROUP BY status;
```

`done` and `skipped` are final; `skipped` with `STILL_REFERENCED` means
another row still uses the file, so it was kept.

## Forgetting a Teacher

Teachers are never anonymized by this job. An administrator forgets a teacher
from the teacher's page in the management console (#877), with ethicapp
running, because ethicapp first finishes the teacher's open activities. No
maintenance window is needed. When the console reports a refusal:

- `ACTIVITIES_NOT_FINISHED`: ethicapp could not finish an activity, or could
  not be reached. Nothing was anonymized. Check the ethicapp logs
  (`[admin-teacher-activities]`) and `activity_finalizations`, then try again.
- `OPEN_ACTIVITIES`: the teacher opened an activity while being forgotten.
  Nothing was anonymized; trying again finishes it first.
- `RECIPIENT_UNAVAILABLE` or `RECIPIENT_CHANGED`: choose the recipient again,
  or none.

Afterwards, follow the account's background work:

```sql
SELECT service_id, status, attempts, last_error
FROM user_erasure_requests
WHERE user_id = <teacher id>;

SELECT path, status, attempts, last_error, next_attempt_at, not_before
FROM upload_deletion_requests
WHERE user_id = <teacher id>
ORDER BY path;
```

A deleted case's directory (`cases/<id>`) whose render was pending or in
progress waits ten minutes before its first attempt (`not_before`). A request
`failed` with `INVALID_PATH` names a path ethicapp refuses to delete; check it
by hand. The retry on the teacher's page resets the requests and file
deletions that are not complete; a directory still waiting for a render stays
pending until its `not_before`.

## Failure Handling

If dry-run fails:

- Keep maintenance mode enabled only if the window has already started.
- Fix the cause.
- Run dry-run again.
- Restore normal service if the window must be cancelled.

If the real run fails:

- Keep app services stopped and NGINX in maintenance mode.
- Inspect `student_anonymization_runs` and `student_anonymization_events`.
- Fix the error.
- Re-run `execute` with `CONFIRM_STUDENT_ANONYMIZATION=true`.

The job is designed for retries: it targets students where
`users.anonymized_at IS NULL`, so already anonymized accounts are not processed
again.

If restoration fails:

- Keep NGINX in maintenance mode.
- Inspect service logs with `docker compose logs <service>`.
- Start failed services manually once the cause is fixed.

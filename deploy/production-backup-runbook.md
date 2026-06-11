# Production Backup Runbook

This runbook describes the repository-owned PostgreSQL and protected uploads
backup procedure for production deployments. The baseline schedule is one daily
backup set with the latest 7 script-created backup sets retained by default.

## Scope

The scripts cover PostgreSQL logical backups and the protected uploads
filesystem path used by uploaded case PDFs and rendered case-document assets.
They do not back up Redis data, TLS assets, deployment secrets, or host-level
configuration. Operators must back up those assets through the deployment
repository or infrastructure platform.

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/production-backup.sh` | Creates a PostgreSQL custom-format dump, archives protected uploads, and prunes older matching backup sets. |
| `scripts/production-backup.sh prune` | Runs only the retention pruning step. |
| `scripts/production-restore.sh` | Restores a custom-format dump into the configured database and restores the matching uploads archive. |
| `scripts/export-production-backup-package.sh` | Exports a minimal host-side backup kit as a `.tar.gz` archive. |

Backup sets are written as:

```text
$BACKUP_DIR/$BACKUP_PREFIX-YYYYMMDD-HHMMSS.dump
$BACKUP_DIR/$BACKUP_PREFIX-YYYYMMDD-HHMMSS-uploads.tar.gz
```

The dump uses PostgreSQL's custom archive format (`pg_dump --format=custom`),
which is already compressed by PostgreSQL and is restored with `pg_restore`.
The uploads archive uses `tar.gz`.

## Configuration

Use the PostgreSQL variables from the deployment contract:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PGHOST` | `localhost` in the scripts | PostgreSQL host. |
| `PGPORT` | `5432` | PostgreSQL port. |
| `PGUSER` | `postgres` | PostgreSQL user. |
| `PGPASSWORD` | none | PostgreSQL password. Required. |
| `PGDATABASE` | `ethicapp` | Database to back up or restore. |
| `PGSSLMODE` | `disable` | PostgreSQL SSL mode. |

Backup-specific variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKUP_DIR` | `/var/backups/ethicapp` | Host directory for backup artifacts. |
| `BACKUP_PREFIX` | `ethicapp` | Filename prefix. Only letters, numbers, dot, underscore, and hyphen are allowed. |
| `BACKUP_RETENTION_COUNT` | `7` | Number of matching script-created backups to keep. |
| `BACKUP_DB_CONTAINER` | unset | Optional PostgreSQL container name for `docker exec` mode. |
| `BACKUP_UPLOADS` | `true` | Whether to include the uploads archive in each backup set. |
| `UPLOADS_PATH` | `/app/backend/uploads` | Protected uploads path to archive and restore. For host cron, set this to the host-mounted uploads path. |
| `PRODUCTION_RESTORE_FORCE` | `false` | Set to `true` to skip the restore confirmation prompt. |
| `RESTORE_UPLOADS` | `true` | Whether to restore the uploads archive. |
| `RESTORE_UPLOADS_REPLACE` | `true` | Whether to clear `UPLOADS_PATH` before extracting the uploads archive. |

When `BACKUP_DB_CONTAINER` is unset, the scripts use host PostgreSQL client
tools (`pg_dump`, `dropdb`, `createdb`, `pg_restore`) and connect directly with
the `PG*` variables. When `BACKUP_DB_CONTAINER` is set, the scripts use
`docker exec` and run PostgreSQL client tools inside that container. In container
mode, set `PGHOST` to a host that resolves from inside the database container,
normally `localhost`.

`UPLOADS_PATH` is always read from the host running the cron job. Production
deployments should mount the protected uploads volume at a stable host path and
set `UPLOADS_PATH` to that path. The database and uploads artifacts should be
created in the same cron run so file references stored in PostgreSQL can be
restored with their corresponding filesystem objects.

## Manual Backup

From the extracted package directory on the production host:

```bash
cd /opt/ethicapp-backup
set -a
. ./.env
set +a
./production-backup.sh
```

For Docker container mode, set these values in `.env`:

```bash
BACKUP_DB_CONTAINER=ethicapp-db
PGHOST=localhost
```

Successful output includes:

- the database name,
- the completed database backup path,
- the completed uploads backup path,
- each backup size in bytes,
- retention status or pruning actions.

The script exits non-zero when Docker is unavailable, the container is not
running, PostgreSQL client tools are missing, the database connection fails, or
either backup artifact is empty.

## Cron Installation

For image-based deployments, generate and publish the minimal backup kit from
this repository instead of requiring a checkout on the production host:

```bash
npm run backup:package
```

By default this creates `dist/ethicapp-production-backup-kit-<version>.tar.gz`.
GitHub Actions can upload that archive as a release artifact alongside the
published Docker image tags.

On the production host, extract the package into an operator-owned directory:

```bash
sudo install -d -m 0750 /opt/ethicapp-backup
sudo tar -xzf ethicapp-production-backup-kit-<version>.tar.gz -C /opt/ethicapp-backup --strip-components=1
cd /opt/ethicapp-backup
sudo cp .env.example .env
sudo chmod 0640 .env
```

Edit `/opt/ethicapp-backup/.env`:

```bash
BACKUP_DIR=/var/backups/ethicapp
BACKUP_PREFIX=ethicapp
BACKUP_RETENTION_COUNT=7
BACKUP_DB_CONTAINER=ethicapp-db
BACKUP_UPLOADS=true
UPLOADS_PATH=/srv/ethicapp/uploads
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=replace-with-production-secret
PGDATABASE=ethicapp
PGSSLMODE=disable
```

Install the cron entry with absolute paths:

```cron
15 2 * * * cd /opt/ethicapp-backup && set -a && . ./.env && set +a && ./production-backup.sh >> /var/log/ethicapp-backup.log 2>&1
```

This example runs daily at 02:15 server local time. Adjust the time to avoid
deployment, migration, and maintenance windows.

Make sure `/var/log/ethicapp-backup.log` is covered by the host log rotation
policy. Do not commit `.env` or any file containing `PGPASSWORD`.

## Retention

Retention keeps the newest `BACKUP_RETENTION_COUNT` database dumps matching
this exact pattern in `BACKUP_DIR` and removes the matching uploads archive for
each pruned dump:

```text
$BACKUP_PREFIX-[0-9]{8}-[0-9]{6}.dump
$BACKUP_PREFIX-[0-9]{8}-[0-9]{6}-uploads.tar.gz
```

Files with other names are ignored, including manual restore test dumps,
temporary files, notes, and backups from other systems. Orphan uploads archives
without a matching database dump are also ignored by pruning so the script does
not delete ambiguous files. Pruning runs only after a successful backup set, or
when explicitly invoked:

```bash
cd /opt/ethicapp-backup
set -a
. ./.env
set +a
./production-backup.sh prune
```

## Verification

After installing the cron job:

1. Run `./production-backup.sh` manually from the extracted package with `.env` loaded.
2. Confirm the script exits with status `0`.
3. Confirm the logged database backup path exists and is non-empty.
4. Confirm the logged uploads backup path exists and is non-empty.
5. Confirm `pg_restore --list path/to/backup.dump` can read the database artifact.
6. Confirm `tar -tzf path/to/uploads.tar.gz` can read the uploads artifact.
7. Seed more than 7 synthetic matching backup sets in a temporary `BACKUP_DIR`,
   run `./production-backup.sh prune`, and confirm only matching old sets are
   removed.
8. Test restore into a disposable database and disposable uploads directory
   before trusting the backup process.

Example restore-list check:

```bash
pg_restore --list /var/backups/ethicapp/ethicapp-YYYYMMDD-HHMMSS.dump >/tmp/ethicapp-backup-list.txt
tar -tzf /var/backups/ethicapp/ethicapp-YYYYMMDD-HHMMSS-uploads.tar.gz >/tmp/ethicapp-uploads-list.txt
```

## Restore Test

Prefer testing restores against a disposable database or isolated environment.
The restore script replaces the configured `PGDATABASE` and, by default, clears
and replaces the configured `UPLOADS_PATH`.

Direct host mode:

```bash
cd /opt/ethicapp-backup
set -a
. ./.env
set +a
export PGHOST=localhost
export PGPORT=5432
export PGUSER=postgres
export PGDATABASE=ethicapp_restore_test
export UPLOADS_PATH=/tmp/ethicapp-uploads-restore-test

PRODUCTION_RESTORE_FORCE=true ./production-restore.sh /var/backups/ethicapp/ethicapp-YYYYMMDD-HHMMSS.dump
```

Container mode:

```bash
cd /opt/ethicapp-backup
set -a
. ./.env
set +a
export BACKUP_DB_CONTAINER=ethicapp-db
export PGHOST=localhost
export PGDATABASE=ethicapp_restore_test
export UPLOADS_PATH=/tmp/ethicapp-uploads-restore-test

PRODUCTION_RESTORE_FORCE=true ./production-restore.sh /var/backups/ethicapp/ethicapp-YYYYMMDD-HHMMSS.dump
```

The restore script infers the uploads archive path from the database dump path.
Pass a second argument only when the archive has a non-standard location:

```bash
PRODUCTION_RESTORE_FORCE=true ./production-restore.sh \
  /var/backups/ethicapp/ethicapp-YYYYMMDD-HHMMSS.dump \
  /safe/offsite/ethicapp-YYYYMMDD-HHMMSS-uploads.tar.gz
```

After restore, run application-level smoke checks or targeted SQL checks against
the disposable database and confirm protected upload paths needed by restored
case records exist under the restored uploads directory. Do not point
application traffic at a restore test database or uploads directory unless the
deployment plan explicitly requires it.

## Failure Handling And Alerts

Cron should treat any non-zero exit code as a failed backup. Wire cron output to
host mail, a log collector, or the deployment monitoring system. Alert when:

- the cron job exits non-zero,
- no successful backup has been created in the last 24 hours,
- the newest database or uploads backup is unexpectedly small,
- backup storage is approaching capacity,
- pruning fails,
- restore-list checks fail for either artifact.

When a backup fails, inspect the latest log lines, verify Docker/container
health when using `BACKUP_DB_CONTAINER`, verify PostgreSQL credentials, and
rerun the backup manually after fixing the root cause.

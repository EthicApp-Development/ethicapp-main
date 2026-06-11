# EthicApp Production Backup Kit

This package contains the minimal host-side scripts for production backup and
restore. It is intended for deployments that run EthicApp from published Docker
images rather than from a repository checkout.

## Files

| File | Purpose |
| --- | --- |
| `production-backup.sh` | Creates a PostgreSQL dump, archives protected uploads, and prunes old backup sets. |
| `production-restore.sh` | Restores a database dump and the matching uploads archive. |
| `.env.example` | Environment template for the production host. |

## Install

Extract the package into an operator-owned directory:

```bash
sudo install -d -m 0750 /opt/ethicapp-backup
sudo tar -xzf ethicapp-production-backup-kit.tar.gz -C /opt/ethicapp-backup --strip-components=1
cd /opt/ethicapp-backup
sudo cp .env.example .env
sudo chmod 0640 .env
```

Edit `.env` and set the production database password, uploads host path,
container name, and backup directory.

## Manual Backup

```bash
cd /opt/ethicapp-backup
set -a
. ./.env
set +a
./production-backup.sh
```

Each successful run creates a backup set:

```text
$BACKUP_DIR/$BACKUP_PREFIX-YYYYMMDD-HHMMSS.dump
$BACKUP_DIR/$BACKUP_PREFIX-YYYYMMDD-HHMMSS-uploads.tar.gz
```

The default retention keeps the latest 7 matching backup sets.

## Cron

Install a cron entry with absolute paths:

```cron
15 2 * * * cd /opt/ethicapp-backup && set -a && . ./.env && set +a && ./production-backup.sh >> /var/log/ethicapp-backup.log 2>&1
```

Make sure `/var/log/ethicapp-backup.log` is covered by host log rotation and
monitoring.

## Verify Artifacts

```bash
pg_restore --list /var/backups/ethicapp/ethicapp-YYYYMMDD-HHMMSS.dump >/tmp/ethicapp-db-backup-list.txt
tar -tzf /var/backups/ethicapp/ethicapp-YYYYMMDD-HHMMSS-uploads.tar.gz >/tmp/ethicapp-uploads-backup-list.txt
```

## Restore Test

Test restores against disposable targets first:

```bash
cd /opt/ethicapp-backup
set -a
. ./.env
set +a
export PGDATABASE=ethicapp_restore_test
export UPLOADS_PATH=/tmp/ethicapp-uploads-restore-test
PRODUCTION_RESTORE_FORCE=true ./production-restore.sh /var/backups/ethicapp/ethicapp-YYYYMMDD-HHMMSS.dump
```

`production-restore.sh` infers the uploads archive path from the database dump
path. Pass a second argument only when the uploads archive has a non-standard
location.

## Alerts

Alert when the cron command exits non-zero, no fresh backup exists in the last
24 hours, either artifact is unexpectedly small, backup storage is near capacity,
or verification commands fail.

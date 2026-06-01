# scripts

This directory contains small utilities for repository maintenance and operational tasks. Most of these shell scripts are intended to be executed as `npm run` tasks at the root directory of the project. See the main [`package-json`](./../package.json) for checking available run scripts.

Database helpers use the development PostgreSQL container (`ethicapp-db`) by default:

```bash
npm run psql
npm run pgdump
npm run pgrestore -- database/dumps/ethicapp-YYYYMMDD-HHMMSS.dump
```

Production PostgreSQL and protected uploads backups are intended for host-level
cron jobs:

```bash
npm run backup:production
npm run backup:production -- prune
PRODUCTION_RESTORE_FORCE=true npm run restore:production -- /var/backups/ethicapp/ethicapp-YYYYMMDD-HHMMSS.dump
```

For image-based deployments, export the minimal host-side backup kit instead of
copying the repository:

```bash
npm run backup:package
```

See [`../deploy/production-backup-runbook.md`](../deploy/production-backup-runbook.md)
for cron installation, retention, verification, restore testing, and alerting
guidance.

Production image publishing is handled by `ghcr-build-push.sh`:

```bash
npm run publish:ghcr -- --owner github-org-or-user --tag v2026.05.11
```

See [`../INSTALL.md`](../INSTALL.md) for the current production image publishing workflow.

Student anonymization maintenance windows are coordinated with:

```bash
npm run anonymization:maintenance -- preflight
npm run anonymization:maintenance -- dry-run
CONFIRM_STUDENT_ANONYMIZATION=true npm run anonymization:maintenance -- execute
npm run anonymization:maintenance -- restore
```

See [`../deploy/student-anonymization-maintenance-runbook.md`](../deploy/student-anonymization-maintenance-runbook.md)
for the full operator runbook and
[`../deploy/student-anonymization-overview.md`](../deploy/student-anonymization-overview.md)
for the capability overview.

# scripts

This directory contains small utilities for repository maintenance and operational tasks. Most of these shell scripts are intended to be executed as `npm run` tasks at the root directory of the project. See the main [`package-json`](./../package.json) for checking available run scripts.

Database helpers use the development PostgreSQL container (`ethicapp-db`) by default:

```bash
npm run psql
npm run pgdump
npm run pgrestore -- database/dumps/ethicapp-YYYYMMDD-HHMMSS.dump
```

Production image publishing is handled by `ghcr-build-push.sh`:

```bash
npm run publish:ghcr -- --owner github-org-or-user --tag v2026.05.11
```

See [`../INSTALL.md`](../INSTALL.md) for the current production image publishing workflow.

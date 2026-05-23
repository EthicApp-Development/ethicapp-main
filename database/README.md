# Database migrations

This directory contains Flyway migrations for setting up and evolving the
EthicApp PostgreSQL schema.

Migration scripts live in `database/migrations` and follow Flyway's standard
versioned naming convention:

```text
V1__base_active_schema.sql
V2__designs_and_activities.sql
```

The development stack uses the official `postgres:16` image plus a Flyway
service. On `docker compose up`, Compose waits for PostgreSQL to become healthy,
runs Flyway from `filesystem:/flyway/migrations`, and starts the application
services after migrations complete.

Useful commands:

```bash
npm run db:migrate
npm run db:info
npm run db:validate
```

When changing PostgreSQL major versions in local development, recreate the
`pgdata` Docker volume so the database can be initialized from these migrations
again.

If you run the development stack with an explicit Compose project name, use the
same project name when removing volumes:

```bash
docker compose -p ethicapp down -v --remove-orphans
docker compose -p ethicapp up --build
```

# Database config SQL scripts

This directory contains hand-made migrations scripts for setting up the database schema.

The development Docker image uses PostgreSQL 16. When changing PostgreSQL major
versions in local development, recreate the `pgdata` Docker volume so the
database can be initialized from these scripts again.

If you run the development stack with an explicit Compose project name, use the
same project name when removing volumes:

```bash
docker compose -p ethicapp down -v --remove-orphans
docker compose -p ethicapp up --build
```

# EthicApp Deployment Configuration Contract

`env.contract.yml` is the canonical environment-variable contract for EthicApp.

Deployment repositories should consume this file from the same git tag as the Docker images being deployed. The deployment repository should provide environment-specific values and secrets, then render the concrete `.env` files required by Docker Compose or the target runtime.

Recommended deployment flow:

1. Select an EthicApp release tag.
2. Fetch `deploy/env.contract.yml` from that tag.
3. Validate the deployment environment values against the contract.
4. Render runtime-specific `.env` files from the contract projections.
5. Deploy the images built from the same release tag.

For partial releases, keep an explicit deployment manifest in the deployment
repository. Use [`deployment.manifest.example.yml`](./deployment.manifest.example.yml)
as the starting format: pin the contract source ref/revision, every project
image, and external images such as PostgreSQL and Redis. The contract should come from the
source ref that reflects the deployed runtime contract, not from the newest tag
by date.

The contract distinguishes:

- `secret: true`: values that must come from a secret manager or protected deployment store.
- `phase: build`: values required while building artifacts.
- `phase: runtime`: values required when containers start.
- `phase: build-and-runtime`: values needed in both places.

All `VITE_*` variables are public frontend variables. They must never contain secrets.

Use service-specific session secrets where the contract provides them. For
example, `auth-backend` uses `AUTH_SESSION_SECRET` for `auth.sid`, while
`management-console` uses `MNG_SESSION_SECRET` for `ethicapp.mng.sid`. These
values do not need to match. `SESSION_SECRET` remains a shared fallback for
legacy-compatible services, not the preferred production setting.

`AUTH_INTERNAL_SERVICE_TOKEN` is a shared secret between `management-console`
and `auth-backend`. It allows management-console to make server-to-server auth
calls that are exempt from browser CSRF checks. Production deployments must set
the same non-placeholder value in both services. The deployment contract marks
this variable as required and intentionally provides no default. This token is
service authentication for internal calls, not a browser CSRF token; do not
expose it in frontend runtime config or any `VITE_*` variable.

Production images keep frontend bundles environment-neutral. Container entrypoints
emit public `VITE_*` values into each frontend's `runtime-config.js` when the
container starts, so deployment repositories should provide those values as
runtime environment variables instead of rebuilding images per environment.

Database schema changes are delivered through the `db-migrations` image. This
image is based on Flyway and includes `database/migrations` from the release.
Run it as a short-lived migration job before starting or updating application
services. Production deployments should not rely on bind-mounted migration files
or a git checkout on the target host. The image accepts the same `PG*`
connection variables used by the application services and maps them to Flyway
configuration at startup. It also falls back to `POSTGRES_DB`, `POSTGRES_USER`,
and `POSTGRES_PASSWORD` when the migration job uses the database env file.

Redis is role-specific in production. Use `REDIS_SESSION_*` for Express session
storage and `REDIS_CACHE_*` for database-derived cache entries. Production
deployments should expose distinct service names, normally `redis-session` and
`redis-cache`, and should not provide generic `REDIS_HOST`, `REDIS_PORT`, or
`REDIS_URL` fallbacks. Development may map both roles to the same Redis instance.
The default production memory limits are `REDIS_SESSION_MAXMEMORY=128mb` and
`REDIS_CACHE_MAXMEMORY=256mb`.

The PDF render worker is a separate process that uses the same `ethicapp` image.
Deploy it as its own service with `ETHICAPP_PROCESS_ROLE=pdf-render-worker`,
provide the `PDF_RENDER_*` variables from the contract, and mount the same
protected uploads volume used by `ethicapp`. Do not expose rendered PDF pages or
manifests through NGINX/static mounts; they must stay behind authorization-aware
application endpoints.

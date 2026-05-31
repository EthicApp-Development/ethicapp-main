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

## Browser Session Policy

Browser authentication uses opaque, Redis-backed Express sessions issued by
`auth-backend`. The browser receives only the signed `auth.sid` cookie; session
contents remain server-side in the session Redis store. Production deployments
should use `REDIS_SESSION_*` for this Redis role and keep it separate from
`REDIS_CACHE_*`.

`auth-backend` enforces role-aware idle and absolute timeouts:

| Role | Idle timeout variable | Default | Absolute timeout variable | Default |
| --- | --- | --- | --- | --- |
| Administrator (`S`) | `AUTH_SESSION_ADMIN_IDLE_TIMEOUT_MS` | `7200000` ms (2 hours) | `AUTH_SESSION_ADMIN_ABSOLUTE_TIMEOUT_MS` | `28800000` ms (8 hours) |
| Professor (`P`) | `AUTH_SESSION_PROFESSOR_IDLE_TIMEOUT_MS` | `604800000` ms (7 days) | `AUTH_SESSION_PROFESSOR_ABSOLUTE_TIMEOUT_MS` | `2592000000` ms (30 days) |
| Student (`A`) | `AUTH_SESSION_STUDENT_IDLE_TIMEOUT_MS` | `86400000` ms (24 hours) | `AUTH_SESSION_STUDENT_ABSOLUTE_TIMEOUT_MS` | `604800000` ms (7 days) |

Sessions renew on protected browser traffic through NGINX `auth_request`.
`auth-backend` updates the session's last-seen timestamp and emits a refreshed
`Set-Cookie`; NGINX propagates that cookie to the browser. Renewal is throttled
by `AUTH_SESSION_TOUCH_INTERVAL_MS`, which defaults to `300000` ms (5 minutes)
and is capped internally at half of the role idle timeout to avoid excessive
session-store writes.

`AUTH_SESSION_COOKIE_MAX_AGE_MS` and `AUTH_SESSION_TTL_SECONDS` are upper bounds
for the auth session cookie and Redis key lifetime. Their defaults are
`2592000000` ms and `2592000` seconds, matching the longest default absolute
timeout. Role-aware idle and absolute checks can invalidate an auth session
earlier than those storage-level limits.

Password reset, administrator password rotation, user role changes, disabling a
user, and similar account-sensitive changes increment `users.session_version`.
Every authenticated request compares the session's stored version with the
current user record. A mismatch destroys the old session and returns `401`, so
existing browser sessions are revoked even if their Redis TTL has not expired.

`management-console` also has its own local application cookie,
`ethicapp.mng.sid`. This cookie stores management-console-local state such as
CSRF data and the user identity hydrated from the auth proxy. It is not the
primary authentication session; authenticated access still depends on
`auth-backend` and NGINX `auth_request`. Configure this local cookie with:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MNG_SESSION_COOKIE_NAME` | `ethicapp.mng.sid` | Management-console local session cookie name. |
| `MNG_SESSION_COOKIE_MAX_AGE_MS` | `7200000` ms (2 hours) | Management-console local cookie lifetime. |
| `MNG_SESSION_SECRET` | no production default | Management-console local session signing secret. |

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

## NGINX Maintenance Mode

The `nginx` image can start in maintenance mode by setting
`NGINX_MAINTENANCE_MODE=true`. In that mode, NGINX does not proxy to
application services. It serves a static English maintenance page with
`503 Service Unavailable` for public application routes, including `/`,
`/student/`, `/mng/`, and `/auth/login`.

Set `NGINX_MAINTENANCE_RETRY_AFTER` to control the `Retry-After` header. The
default is `3600`, which means clients should retry after one hour.

The `/healthz` and `/readyz` endpoints return `200` with the text
`maintenance`, so operators can verify that NGINX is up while application
services are intentionally stopped. Disable maintenance mode by starting NGINX
again with `NGINX_MAINTENANCE_MODE=false` or by unsetting the variable.

Database schema changes are delivered through the `db-migrations` image. This
image is based on Flyway and includes `database/migrations` from the release.
Run it as a short-lived migration job before starting or updating application
services. Production deployments should not rely on bind-mounted migration files
or a git checkout on the target host. The image accepts the same `PG*`
connection variables used by the application services and maps them to Flyway
configuration at startup. It also falls back to `POSTGRES_DB`, `POSTGRES_USER`,
and `POSTGRES_PASSWORD` when the migration job uses the database env file.

Semantic tag taxonomies are delivered with the `ethicapp` image under
`/database/seeds/tag-taxonomies`. The web entrypoint runs the taxonomy seed
before starting the application in every runtime mode. The seed is idempotent:
new or edited JSON taxonomy files from the deployed release are upserted into
`tag_taxonomies`, `tag_categories`, `tags`, translations, and aliases. Leave
`ETHICAPP_SEED_TAG_TAXONOMIES=true` in production unless the deployment mounts
and manages a different seed directory through `ETHICAPP_TAG_TAXONOMY_SEED_DIR`.

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

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

## AI Services

Whether an installation uses AI, where AI Additions is, which AI services are
allowed and which of their adapters are switched off are data that operators
edit in the management console
(`/mng/ai-services`, epic #810). Deployments provide only the AI Additions
client credentials. The full operator guide, with the console steps and the
pinning rules, is
[AI Services (AI Additions)](../INSTALL.md#ai-services-ai-additions) in
`INSTALL.md`; the dispatch gate and callback rules are in
[`EXTERNAL.md`](../EXTERNAL.md).

The `ethicapp` image ships a single adapter catalog
(`/app/backend/external-services/manifest.json`, #812). Deployments do not
select or edit it. Mock adapters register only with
`EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`, which only the local
development Compose file sets; leave it unset or `false` in deployments.

What a deployment target sets in each scenario:

| Scenario | `ethicapp` values | AI Additions values | After deploying |
| --- | --- | --- | --- |
| No AI (default) | None of the `AI_ADDITIONS_*` variables are needed. | No AI Additions deployment. | Nothing. Check the runbook in `INSTALL.md`, "Installation without AI". |
| AI Additions on the same Docker host or network | `AI_ADDITIONS_KEYCLOAK_CLIENT_ID`, `AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET` (via the secret store), `AI_ADDITIONS_KEYCLOAK_REALM`; `extra_hosts` or a shared network so `ethicapp` resolves AI Additions. | `KEYCLOAK_PUBLIC_URL`, `*_ETHICAPP_CALLBACK_URL` pointing at EthicApp's `/external-services/callbacks`. | In the console: connection with a Docker-internal `base_url`, plus `keycloak_public_url` = AI Additions' `KEYCLOAK_PUBLIC_URL` when it is not `base_url/keycloak`; test; allow services; save a version. |
| AI Additions on a separate host | The same client credentials. | HTTPS in front of its NGINX; `KEYCLOAK_PUBLIC_URL` = its public HTTPS URL plus `/keycloak`; `*_ETHICAPP_CALLBACK_URL` = `https://<ethicapp-host>/external-services/callbacks`. Both hosts must reach each other over HTTPS. | Connection with the HTTPS `base_url`; test; allow services; save a version. |
| Upgrade from environment-configured AI | Delete the removed variables listed below; keep the client credentials. | A release that serves the catalog (`ai-catalog`). | V22 to V24 run. Policy version 1 allows nothing, so running sessions lose AI for good and only activities launched after a policy is saved use it. Configure the connection and save a policy as above. |

Removed from the contract with no fallback, so delete them from every target
and from the deployment repository's environment files when moving to a
release from epic #810: `AI_ADDITIONS_BASE_URL`,
`AI_ADDITIONS_KEYCLOAK_BASE_URL`, `AI_ADDITIONS_KEYCLOAK_TOKEN_URL`, the three
`AI_ADDITIONS_*_API_BASE_URL`, `EXTERNAL_SERVICES_CALLBACK_AUTH_ISSUER`,
`EXTERNAL_SERVICES_CALLBACK_AUTH_JWKS_URL` and `EXTERNAL_SERVICES_MANIFEST`.
A validator that rejects undeclared variables, such as `ethicapp-deployment`'s
`scripts/validate-env.sh`, fails on a target that keeps one of them. The
post-deploy console steps are part of the release and belong in its session
record.

## reCAPTCHA Enterprise

The recommended reCAPTCHA provider for `auth-backend` and `management-console`
is Enterprise:

```bash
RECAPTCHA_ENABLED=true
RECAPTCHA_PROVIDER=enterprise
RECAPTCHA_ENTERPRISE_PROJECT_ID=your-google-cloud-project-id
RECAPTCHA_ENTERPRISE_API_KEY=change-this-in-production
VITE_RECAPTCHA_SITE_KEY=your-public-enterprise-site-key
```

`RECAPTCHA_PROVIDER` and `VITE_RECAPTCHA_SITE_KEY` are public runtime frontend
configuration. `RECAPTCHA_ENTERPRISE_API_KEY` is a backend-only secret and
should be restricted to the reCAPTCHA Enterprise API where possible.

Without billing, reCAPTCHA Enterprise allows 10,000 assessments per calendar
month per Google Cloud project. The `CreateAssessment` API fails closed with
HTTP `429 Resource Exhausted` when quota is exhausted, so production operators
should enable billing or quota monitoring if traffic might exceed the free
quota.

`RECAPTCHA_PROVIDER=classic` remains supported for transition or rollback only:

```bash
RECAPTCHA_PROVIDER=classic
RECAPTCHA_SECRET_KEY=your-classic-secret
RECAPTCHA_VERIFY_URL=https://www.google.com/recaptcha/api/siteverify
```

Use service-specific session secrets where the contract provides them. For
example, `auth-backend` uses `AUTH_SESSION_SECRET` for `auth.sid`, while
`management-console` uses `MNG_SESSION_SECRET` for `ethicapp.mng.sid`. These
values do not need to match. `SESSION_SECRET` remains a shared fallback for
legacy-compatible services, not the preferred production setting.

## Browser Session Policy

Browser authentication uses opaque, Redis-backed Express sessions issued by
`auth-backend`. The browser receives only the signed `auth.sid` cookie; session
contents remain server-side in the application Redis. Production deployments
should use `REDIS_APP_*` for this Redis role and keep it separate from
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

In normal production mode, NGINX renders its upstream configuration from
`nginx/conf.d/default.conf.template` at container startup. The upstream service
names remain stable Docker DNS names, while the ports come from the same
deployment contract variables used by the application services:

| Upstream | Service DNS name | Port variable |
| --- | --- | --- |
| Legacy EthicApp | `ethicapp` | `ETHICAPP_NODE_PORT` |
| Auth backend | `auth-backend` | `PORT` |
| Student app | `ethicapp-student` | `ETHICAPP_STUDENT_NODE_PORT` |
| Management console | `management-console` | `MNG_PORT` |

Provide these variables to the NGINX container as well as the owning
application containers. This keeps production proxy routing aligned with the
deployment contract and avoids hard-coded internal ports. The rendered
production config also preserves the `auth_request` session-renewal behavior:
protected routes read `Set-Cookie` from the auth check response and propagate it
back to the browser so sliding sessions continue to work in production.

## NGINX Error Responses and Request Correlation

NGINX classifies each request as a page navigation or an API call. It uses
`Sec-Fetch-Mode: navigate`, then `Sec-Fetch-Dest: document`, then an `Accept`
header containing `text/html`; every other request counts as an API call. The
classification only changes how NGINX answers errors it produces itself:

| Situation | Page navigation | API call |
| --- | --- | --- |
| Missing or expired session on a protected route | `302` to `/auth/login` | `401` with `{"status":"expired"}` |
| Upstream down or timed out, or auth check failed (`500`, `502`, `503`, `504`) | Readable "temporarily unavailable" page, same status | `{"status":"unavailable"}`, same status |

Errors returned by the applications themselves pass through unchanged. When
`auth-backend` expires a session, NGINX also forwards the `Set-Cookie` that
clears the auth cookie, on both the redirect and the JSON `401`.

Every response carries an `X-Request-Id` header. NGINX keeps a well-formed
`X-Request-Id` set by a proxy in front of it (8 to 128 characters from
`A-Z a-z 0-9 . _ -`) and generates one otherwise. It forwards the id to every
upstream, and the unavailable page shows it as a reference users can report.

Access log lines use the `ethicapp_edge` format, which includes `request_id`,
the request classification, the auth check status, the user id, the upstream
status, and upstream and total response times. `ethicapp` logs the same
`request_id`, so an edge line can be joined with the application line for the
same request. No environment variables are involved.

## Student Anonymization

Periodic student data anonymization is documented in
[`student-anonymization-overview.md`](./student-anonymization-overview.md).
That document explains the implemented components, data coverage, audit model,
runtime variables, and verification approach. Operators should use
[`student-anonymization-maintenance-runbook.md`](./student-anonymization-maintenance-runbook.md)
for the step-by-step maintenance window procedure and
[`student-anonymization-data-map.md`](./student-anonymization-data-map.md) for
field-level coverage decisions.

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

Redis is role-specific in production. Use `REDIS_APP_*` for the application
Redis: Express session storage, the domain-event pub/sub channel that
`ethicapp-student` uses to notify `ethicapp` (`canonical-schemas/events/README.md`),
and other application state that must not be evicted as cache. Use
`REDIS_CACHE_*` for database-derived cache entries. Production deployments should
expose distinct service names, normally `redis-app` and `redis-cache`, and should
not provide generic `REDIS_HOST`, `REDIS_PORT`, or `REDIS_URL` fallbacks.
Development may map both roles to the same Redis instance. The default
production memory limits are `REDIS_APP_MAXMEMORY=128mb` and
`REDIS_CACHE_MAXMEMORY=256mb`.

### Migrating from `REDIS_SESSION_*`

`REDIS_APP_*` replaces `REDIS_SESSION_*` (#660). The old names are not part of
the contract and the services no longer read them, so a deployment adopting this
release must rename them in the same change:

1. Rename `REDIS_SESSION_HOST`, `REDIS_SESSION_PORT`, `REDIS_SESSION_URL`,
   `REDIS_SESSION_MAXMEMORY` and `REDIS_SESSION_MAXMEMORY_POLICY` to their
   `REDIS_APP_*` equivalents in the environment values.
2. Rename the Redis service to `redis-app`, or add `redis-app` as a network alias
   of the existing `redis-session` service. Keeping the same data volume means no
   data migration: existing sessions survive the rename.

The PDF render worker is a separate process that uses the same `ethicapp` image.
Deploy it as its own service with `ETHICAPP_PROCESS_ROLE=pdf-render-worker`,
provide the `PDF_RENDER_*` variables from the contract, and mount the same
protected uploads volume used by `ethicapp`. Do not expose rendered PDF pages or
manifests through NGINX/static mounts; they must stay behind authorization-aware
application endpoints.

## Design Case Associations

From this release on, `POST /designs` and `PATCH /designs/:id` accept a case
only when the teacher may pick it in the design editor's case search: it
exists, it is not archived, and it is the teacher's own or public (#924).
Earlier releases stored any `caseId`, and a design's creator may read its case,
the case PDF and the rendered pages. A design that points at another teacher's
private case therefore gives its creator read access to that case.

Such a row has one of two origins. A teacher may have picked the case while it
was public, before its author made it private: `PATCH /cases/:id/visibility`
turns the public designs that use the case private and leaves every design's
`case_id` as it is. Or someone crafted a request to an earlier release. The new
check keeps a design's unchanged `case_id` on update, so the rows below remain
until someone acts on them.

Before deploying, run this read-only query against the production database and
keep its output:

```sql
SELECT d.id AS design_id,
       d.creator AS design_creator,
       d.visibility AS design_visibility,
       d.locked AS design_locked,
       c.id AS case_id,
       c.creator AS case_creator,
       c.archived AS case_archived,
       EXISTS (SELECT 1 FROM activity AS a WHERE a.design = d.id) AS used_by_activity
FROM designs AS d
INNER JOIN ethical_cases AS c ON c.id = d.case_id
WHERE c.visibility IS DISTINCT FROM 'public'
  AND c.creator IS DISTINCT FROM d.creator
ORDER BY c.id, d.id;
```

The query changes no data. Each row is a design whose creator reads another
teacher's private case through it. The database records neither when a design
was created nor when the case became private, so the data alone cannot tell the
two origins apart: review each row with the case's author before changing it.
Detaching a case (`UPDATE designs SET case_id = NULL WHERE id = ...`) removes
the access, and it also removes the case from that design and from the
activities launched from it (`used_by_activity`), which then show no case. Take a backup first
([`production-backup-runbook.md`](./production-backup-runbook.md)).

### Private cases with public designs

Anyone may read a case that a public design points at, together with its PDF
and rendered pages. So when a case becomes private, the public designs that use
it become private as well. `PATCH /cases/:id/visibility` (the share switch on
the case card) has done so; from this release on, `PATCH /cases/:id` (the case
form) does too (#934). Earlier releases left the designs public when the
teacher made the case private through the form, and the case stayed readable by
every teacher and student.

Before deploying, run this read-only query against the production database and
keep its output:

```sql
SELECT c.id AS case_id,
       c.creator AS case_creator,
       c.visibility AS case_visibility,
       d.id AS design_id,
       d.creator AS design_creator,
       d.archived AS design_archived,
       EXISTS (SELECT 1 FROM activity AS a WHERE a.design = d.id) AS used_by_activity
FROM ethical_cases AS c
INNER JOIN designs AS d ON d.case_id = c.id
WHERE c.visibility IS DISTINCT FROM 'public'
  AND d.visibility = 'public'
ORDER BY c.id, d.id;
```

The query changes no data. Each row is a public design that keeps a private
case readable. Once this release is deployed, the case's author repairs a case
by saving it through the case form with the visibility left private, or by
switching it to public and back to private on its card: both turn its public
designs private. Neither works while a launched activity uses the case
(`used_by_activity`, or another design of the case used by an activity), since
both refuse to change such a case. For those cases, decide with the case's
author, take a backup first, and run the statement the endpoints run, for one
case at a time:
`UPDATE designs SET visibility = 'private', public = false WHERE case_id = ... AND visibility = 'public'`.

## Health Diagnostics Targets

`MNG_HEALTH_CHECK_TARGETS` is the allowlist used by the management-console
health diagnostics to check DNS resolution and outbound connectivity. The
console only contacts the hosts listed here; requests to the diagnostics API
cannot add or change targets.

The value is a comma-separated list of `label=host:port` entries:

```text
MNG_HEALTH_CHECK_TARGETS=smtp=smtp.gmail.com:465,openai=api.openai.com:443
```

| Rule | Detail |
| --- | --- |
| Label | Lowercase letters, digits and hyphens, up to 40 characters, unique per list. |
| Host | Hostname or IP address, without scheme, credentials or path. Write IPv6 addresses as `[address]:port`. |
| Port | Integer from 1 to 65535. |
| Size | At most 20 entries. |

Invalid, duplicate or excess entries are ignored and reported as warnings when
the management-console starts. When the variable is unset or empty, no targets
are checked.

List the external dependencies whose failure would break the platform, such as
the SMTP relay configured in `SMTP_HOST`/`SMTP_PORT` for `auth-backend` and the
AI provider endpoints reached by external-service adapters. management-console
does not receive `SMTP_HOST`, so the SMTP relay has to be listed explicitly.

The diagnostics page (`/mng/diagnostics`) and how to read its DNS and
connectivity results are described in
[`health-diagnostics-runbook.md`](./health-diagnostics-runbook.md).

## Production Backups

Host-level PostgreSQL and protected uploads backups are handled by
[`scripts/production-backup.sh`](../scripts/production-backup.sh). The default
retention keeps the latest 7 script-created backup sets. Each set includes a
PostgreSQL custom-format dump and a protected uploads tar archive, with backup
paths, sizes, failures, and pruning actions logged to stdout/stderr for cron or
monitoring capture.

For image-based deployments, publish the minimal host-side kit generated by
`npm run backup:package` and install that archive on the production host.
Operators should run the included script through cron and keep secrets in the
package-local `.env` file outside version control. Use
[`production-backup-runbook.md`](./production-backup-runbook.md) for cron
installation, variables, verification, restore testing, and alerting guidance.

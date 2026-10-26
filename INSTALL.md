# EthicApp Deployment

The production deployment strategy is being redesigned around immutable Docker images. This repository owns image builds. A separate deployment repository can then consume those images through Compose, Kubernetes, or another runtime-specific template.

This document covers the current image publishing flow for GitHub Container Registry (GHCR).

## Configuration Contract

EthicApp's canonical environment-variable contract lives in [`deploy/env.contract.yml`](./deploy/env.contract.yml). Deployment repositories should consume that file from the same git tag as the images being deployed, then provide environment-specific values and secrets.

The deployment repository should not redefine the variable catalog from scratch. Instead, it should:

1. Select an EthicApp release tag.
2. Fetch `deploy/env.contract.yml` from that tag.
3. Validate environment-specific values against the contract.
4. Render the concrete `.env` files needed by the target runtime.
5. Deploy image tags built from the same EthicApp release tag.

See [`deploy/README.md`](./deploy/README.md) for the contract usage model.

For partial releases, use an explicit deployment manifest instead of inferring
the contract from the newest image tag. This repository includes
[`deploy/deployment.manifest.example.yml`](./deploy/deployment.manifest.example.yml)
as a template for pinning:

- the `env.contract.yml` source ref and commit,
- every EthicApp project image by tag and, preferably, digest,
- unchanged service images that remain part of the deployment,
- external images such as PostgreSQL and Redis.

The deployment repository should copy or render this manifest for each promoted
environment. When only `ethicapp` and `nginx` are rebuilt, those two entries can
move to the new tag while the other services stay pinned to their previous tags.
The contract entry should point to the source ref whose `env.contract.yml`
matches the environment files being rendered.

When a change adds, renames or removes a variable in `deploy/env.contract.yml`,
the deployment repository must refresh its copy of the contract for every
target that deploys that change, update the manifest's `env_contract` source
ref, and set the target values before the release is deployed. For example,
`MNG_HEALTH_CHECK_TARGETS` (management-console health diagnostics allowlist,
see [`deploy/README.md`](./deploy/README.md#health-diagnostics-targets)) needs
per-target values listing the external dependencies to check.

When outbound email, AI features or other external integrations fail, use the
management-console diagnostics page and
[`deploy/health-diagnostics-runbook.md`](./deploy/health-diagnostics-runbook.md)
to tell DNS failures from network or TLS problems.

Pay special attention to `VITE_*` variables. They are public frontend variables, not secrets. Production images keep frontend bundles environment-neutral; each container writes its frontend `runtime-config.js` from runtime environment variables when it starts.

## reCAPTCHA Enterprise

New deployments should use reCAPTCHA Enterprise for `auth-backend` and
`management-console`:

```bash
RECAPTCHA_ENABLED=true
RECAPTCHA_PROVIDER=enterprise
RECAPTCHA_ENTERPRISE_PROJECT_ID=your-google-cloud-project-id
RECAPTCHA_ENTERPRISE_API_KEY=change-this-in-production
VITE_RECAPTCHA_SITE_KEY=your-public-enterprise-site-key
```

`RECAPTCHA_PROVIDER` and `VITE_RECAPTCHA_SITE_KEY` are public frontend
configuration emitted into `runtime-config.js`; they are not secrets.
`RECAPTCHA_ENTERPRISE_API_KEY` is backend-only secret configuration and should
be restricted in Google Cloud to the reCAPTCHA Enterprise API when possible.

Without billing, Google Cloud provides 10,000 reCAPTCHA Enterprise assessments
per calendar month per Google Cloud project. The modern `CreateAssessment` API
fails closed with HTTP `429 Resource Exhausted` when quota is exhausted, which
can block registration, forgot-password, and management sensitive-action
fallback flows. Production environments that may exceed that free quota should
enable billing or monitor quota before rollout.

`RECAPTCHA_PROVIDER=classic` remains available only as a transition or rollback
path through the legacy `siteverify` endpoint:

```bash
RECAPTCHA_PROVIDER=classic
RECAPTCHA_SECRET_KEY=your-classic-secret
RECAPTCHA_VERIFY_URL=https://www.google.com/recaptcha/api/siteverify
```

## Case Videos (YouTube Data API)

Cases can list YouTube videos (epic #779). `ethicapp` looks up their title,
description and duration with the YouTube Data API v3, using a Google Cloud API
key:

```bash
GOOGLE_API_KEY=change-this-in-production
YOUTUBE_DATA_API_TIMEOUT_MS=8000
YOUTUBE_METADATA_CACHE_TTL_SECONDS=86400
```

To create the key, enable the YouTube Data API v3 in a Google Cloud project,
create an API key there, and restrict it to that API. The case documents below
reuse the same key, which then needs the Drive API in its restriction too. The
key is a backend-only secret.

Without `GOOGLE_API_KEY`, case video support is off: teachers cannot add videos,
and `GET /cases/videos/support` answers `{ "enabled": false }`.

Metadata is cached in the cache Redis (`REDIS_CACHE_*`) for
`YOUTUBE_METADATA_CACHE_TTL_SECONDS`, 24 hours by default. Values above 2592000
(30 days, YouTube's storage limit for API data) are capped. Each lookup that
misses the cache costs 1 unit of the project's YouTube quota, 10,000 units a day
by default, for up to 50 videos. Teachers' URL previews are limited to 30 a
minute per teacher.

## Case Documents (Google Drive API)

Cases can list Google Docs, Sheets, Slides and Drive files shared as "Anyone
with the link", and documents published to the web (epic #789). `ethicapp`
checks that each one opens for anyone, and reads its name, with the same
`GOOGLE_API_KEY`:

```bash
GOOGLE_API_KEY=change-this-in-production
GOOGLE_DOCUMENT_TIMEOUT_MS=8000
GOOGLE_DOCUMENT_CACHE_TTL_SECONDS=900
```

The Google Cloud project of the key must enable the Google Drive API, and a key
restricted by API must allow the Drive API next to the YouTube Data API v3. A
key restricted by IP address must allow both the server's IPv4 and IPv6 egress
addresses: a request from an address outside the list fails with HTTP 403, so
new documents cannot be added and existing ones show as not verified.

How a document is checked:

- A Drive file is looked up with the Drive API v3 `files.get`, with the key in
  the `X-Goog-Api-Key` header. When the API answers 404, an anonymous request to
  the document's URL tells a restricted document (401, or a redirect to the
  Google sign-in page) from a missing one (404).
- A document published to the web is checked with an anonymous request to its
  published URL only, and its name is read from the page title.

Without `GOOGLE_API_KEY`, document attachments are off, published links
included: teachers cannot add documents, and `GET /cases/documents/support`
answers `{ "enabled": false }`.

Results are cached in the cache Redis (`REDIS_CACHE_*`): an available document
for `GOOGLE_DOCUMENT_CACHE_TTL_SECONDS`, 15 minutes by default and at most 86400
(one day); a document found not public or missing for 120 seconds. Failed
checks (timeouts, HTTP 403, 429 or 5xx) are not cached. Teachers' URL previews
are limited to 30 a minute per teacher.

## Redis Topology

Production deployments use two Redis instances:

- `redis-app` (the application Redis): Express session storage for `ethicapp`, `auth-backend` and `ethicapp-student`, the domain-event channel from `ethicapp-student` to `ethicapp` (see `canonical-schemas/events/README.md`), and other application state that must not be evicted as cache. If it is unavailable, `ethicapp-student` keeps serving requests with sessions rebuilt from the auth headers.
- `redis-cache`: database-derived cache entries used by the legacy `ethicapp` application.

Development keeps a single Redis instance. In development, both `REDIS_APP_*` and `REDIS_CACHE_*` point to the same `redis` service.

Use role-specific variables in deployment environments:

```bash
REDIS_APP_HOST=redis-app
REDIS_APP_PORT=6379
REDIS_CACHE_HOST=redis-cache
REDIS_CACHE_PORT=6379
```

Set Redis container memory limits through the Compose environment:

```bash
REDIS_APP_MAXMEMORY=128mb
REDIS_APP_MAXMEMORY_POLICY=volatile-ttl
REDIS_CACHE_MAXMEMORY=256mb
REDIS_CACHE_MAXMEMORY_POLICY=allkeys-lru
```

The application Redis keeps the `volatile-ttl` eviction policy: keys with a TTL,
such as sessions, can be evicted under memory pressure, and keys without a TTL
are never evicted. Any new application key type must state whether it carries a
TTL.

`REDIS_APP_*` replaces the earlier `REDIS_SESSION_*` names (#660), which are no
longer read. To migrate a deployment, rename the variables and either rename the
Redis service to `redis-app` or give the existing service a `redis-app` alias.
No data migration is needed: existing sessions survive while the new name points
to the same instance.

Do not use generic `REDIS_HOST`, `REDIS_PORT`, or `REDIS_URL` values in production. The services resolve Redis by role-specific variables only, which avoids accidentally routing session traffic and cache traffic to the same Docker DNS name.

## Browser Sessions

Browser authentication is centralized in `auth-backend` through opaque
Redis-backed sessions. The role-aware defaults are:

- Administrators: 2-hour idle timeout, 8-hour absolute timeout.
- Professors: 7-day idle timeout, 30-day absolute timeout.
- Students: 24-hour idle timeout, 7-day absolute timeout.

Protected browser traffic renews sessions through NGINX `auth_request`, with
touches throttled by `AUTH_SESSION_TOUCH_INTERVAL_MS` (default 5 minutes).
Account-sensitive changes increment `users.session_version`, which revokes older
browser sessions on their next authenticated request.

`management-console` additionally uses a local `ethicapp.mng.sid` cookie for
console-local state such as CSRF data. Its default lifetime is 2 hours through
`MNG_SESSION_COOKIE_MAX_AGE_MS`, but the primary authentication decision remains
the `auth-backend` session checked by NGINX.

For the complete operator-facing session variable list, defaults, and
revocation semantics, see the Browser Session Policy section in
[`deploy/README.md`](./deploy/README.md#browser-session-policy).

## AI Services (AI Additions)

EthicApp's AI features come from a separate deployment, EthicApp AI Additions
(`ethicapp-ai-additions`). Whether an installation uses them, and which ones,
is data that the operator edits in the management console, at
`/mng/ai-services` (role `S`). The deployment only provides the AI Additions
client credentials (epic #810). Saving or removing the connection and saving a
policy version require the operator's confirmation, like the other sensitive
console actions: their passkey when they have one, otherwise their password and
reCAPTCHA (#841).

- **Adapter catalog (code).** The `ethicapp` image ships one catalog,
  `backend/external-services/manifest.json`. Every production adapter
  (Polyadic Agents, the Argumentation Tutor, Case Analyst) registers at
  startup, and each declares the AI Additions services it `requires`. There is
  no per-environment manifest and no variable to select one.
- **AI Additions connection (data).** A single, unversioned row,
  `ai_additions_connection`: where EthicApp reaches AI Additions. Without it,
  EthicApp makes no AI call.
- **AI service policy (data).** An append-only list of versions,
  `ai_service_policy_versions`, each naming the AI Additions services allowed.
  Saving a policy creates a new version; versions are never edited.

### Pinning

Each session is pinned to the policy version that is current when its
activity is launched. Its phase hooks reach an adapter only when the phase's
design enables the adapter, the pinned version allows every service the
adapter requires, and a connection is stored. A new version therefore affects
activities launched afterwards; running activities keep their version. Case
analyses (`case-created`) follow the version current when the case is created.
The connection is not versioned: running activities follow it when it changes,
and removing it stops every AI call at once, inbound callbacks included. Design
editors and case forms offer only the services the current version allows, and
launching a design whose services are not allowed shows a notice. See
[`EXTERNAL.md`](./EXTERNAL.md) for the dispatch gate and the callback rules.

### Environment variables

The deployment provides, for an installation that uses AI:

| Variable | Notes |
| --- | --- |
| `AI_ADDITIONS_KEYCLOAK_CLIENT_ID` | The EthicApp client in AI Additions' Keycloak, normally `ethicapp-platform`. |
| `AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET` | Secret. The same value as AI Additions' `ETHICAPP_PLATFORM_CLIENT_SECRET`. |
| `AI_ADDITIONS_KEYCLOAK_REALM` | Defaults to `ethicapp-ai-additions`; must equal AI Additions' `KEYCLOAK_REALM`. |
| `AI_ADDITIONS_KEYCLOAK_SCOPE` | Optional OAuth scope. |
| `AI_ADDITIONS_HTTP_TIMEOUT_MS` | Defaults to `12000`. |
| `AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED`, `AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE` | Polyadic Agents settings with contract defaults. |
| `EXTERNAL_SERVICES_CALLBACK_AUTH_ENABLED`, `_AUDIENCE`, `_CLOCK_TOLERANCE_SECONDS` | Callback token verification; keep `_ENABLED=true`. `_AUDIENCE` must match the audience AI Additions puts in callback tokens. |

Leave `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS` unset or `false` in every
deployment: it registers the mock adapters, which only the local development
Compose stack uses. The management console reaches the internal ethicapp API
through `ETHICAPP_INTERNAL_BASE_URL` to read the AI Additions catalog and test
connections, so the credentials stay in `ethicapp` alone.

### Installation without AI

This is the default: an installation where no operator has saved a connection
uses no AI service. Nothing needs to be set. The `AI_ADDITIONS_*` variables
can stay unset, and no AI Additions deployment is needed.

To check that an installation makes no outbound AI calls:

1. In the management console, `/mng/ai-services` shows "This installation uses
   no external AI".
2. The connection table is empty and no AI job was created since the upgrade
   (or ever):

   ```bash
   docker compose exec postgresql psql -U postgres -d ethicapp -c \
     "SELECT count(*) AS connections FROM ai_additions_connection;"
   docker compose exec postgresql psql -U postgres -d ethicapp -c \
     "SELECT service_id, count(*), max(created_at) FROM external_service_jobs GROUP BY service_id;"
   ```

   `connections` must be `0`. Each hook an AI adapter handles is recorded as a
   job in `external_service_jobs` before any request is sent, so no row newer
   than the upgrade means no hook reached AI Additions.
3. Inbound callbacks are refused: a `POST /external-services/callbacks`
   answers `503` with `code: "not_configured"`, visible as `503` in the NGINX
   access log if anything still sends them.

Use the PostgreSQL service and user names of the target deployment. The
policy history may still show versions; without a connection they have no
effect.

### Enabling AI

1. Deploy AI Additions with a release that serves the service catalog
   (`GET /catalog/v1/services`, the `ai-catalog` service), and configure it as
   in one of the two topologies below.
2. Set the EthicApp client credentials above in the `ethicapp` environment and
   redeploy it.
3. In `/mng/ai-services`, enter the connection: the AI Additions URL
   (`base_url`) and, when needed, the Keycloak public URL
   (`keycloak_public_url`).
4. Select "Test connection". All three steps must pass: the token request,
   the token issuer and the catalog read. An issuer mismatch shows both
   issuers and the Keycloak public URL that would match. A token step that
   fails with `credentials_missing` ("EthicApp has no AI Additions client
   credentials") means step 2 is not done: `AI_ADDITIONS_KEYCLOAK_CLIENT_ID`
   or `AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET` is empty in the `ethicapp`
   environment. No request was sent, so the cause is not on the AI Additions
   side. The catalog under "Allowed services" reports the same code.
5. Save the connection.
6. Under "Allowed services", tick the services to allow, add an optional note
   and select "Save as a new version". Activities launched from now on use
   them.

Removing the connection ("Remove connection") turns AI off again for every
activity. The policy history is kept and applies again if a connection is
saved later.

From the connection EthicApp derives every URL:

| URL | Derivation |
| --- | --- |
| Token endpoint | `base_url/keycloak/realms/<realm>/protocol/openid-connect/token` |
| JWKS (callback verification) | `base_url/keycloak/realms/<realm>/protocol/openid-connect/certs` |
| Expected callback issuer | `<keycloak_public_url or base_url/keycloak>/realms/<realm>` |
| Service APIs and the catalog | `base_url` plus the service path |

Keycloak is always reached through `base_url`. Keycloak writes its own public
hostname (`KC_HOSTNAME`, set from AI Additions' `KEYCLOAK_PUBLIC_URL`) into
every token's `iss`, whatever host the token was requested through, so
`keycloak_public_url` only tells EthicApp which issuer to expect. EthicApp
reads the connection again every few seconds, so a change takes effect without
a restart.

### AI Additions on the same Docker host or network

Use a `base_url` that the `ethicapp` container can resolve, for example the
AI Additions NGINX service name on a shared Docker network
(`http://ai-apps-nginx`) or the host's published port
(`http://host.docker.internal:8311`, with
`extra_hosts: ["host.docker.internal:host-gateway"]` on `ethicapp`). Plain
HTTP is acceptable on a private network.

- `keycloak_public_url`: leave it empty when AI Additions'
  `KEYCLOAK_PUBLIC_URL` equals `base_url` plus `/keycloak`. Otherwise set it
  to AI Additions' `KEYCLOAK_PUBLIC_URL` exactly, for example when AI
  Additions publishes `https://ai.example.edu/keycloak` and EthicApp reaches it
  as `http://ai-apps-nginx`.
- `POLYADIC_AGENTS_ETHICAPP_CALLBACK_URL` and
  `ARGUMENTATION_TUTOR_ETHICAPP_CALLBACK_URL` in AI Additions point to
  EthicApp's callback endpoint, `/external-services/callbacks`, at a URL the
  AI Additions containers can reach: EthicApp's public URL, or its NGINX
  service on the shared network.

### AI Additions on a separate host

- Publish AI Additions over HTTPS: put a TLS-terminating reverse proxy in front
  of its NGINX facade, and use that URL as `base_url`, for example
  `https://ai.example.edu`.
- AI Additions' `KEYCLOAK_PUBLIC_URL` must be its public HTTPS URL plus
  `/keycloak` (`https://ai.example.edu/keycloak`), and its
  `KEYCLOAK_ISSUER_URL` the same value. With that, `keycloak_public_url` can
  stay empty in the console. If AI Additions publishes Keycloak at another
  URL, enter that URL as `keycloak_public_url`.
- AI Additions' `POLYADIC_AGENTS_ETHICAPP_CALLBACK_URL` and
  `ARGUMENTATION_TUTOR_ETHICAPP_CALLBACK_URL` must be
  `https://<ethicapp-host>/external-services/callbacks`.
- The network must allow both directions: the `ethicapp` container reaches
  `base_url` on 443 (token, catalog and service calls), and the AI Additions
  services reach EthicApp's public HTTPS URL (callbacks). Firewalls, VPNs and
  IP allowlists must permit both. The management-console diagnostics page can
  check the outbound side if the AI Additions host is listed in
  `MNG_HEALTH_CHECK_TARGETS` (see
  [`deploy/README.md`](./deploy/README.md#health-diagnostics-targets)).
- The EthicApp client credentials belong to that AI Additions installation.
  Pointing the connection at a different installation also needs its
  credentials redeployed in `ethicapp`.

### Upgrading from environment-configured AI

Releases from epic #810 on take the AI Additions location from the database.
The upgrade affects only installations that used AI.

1. Delete these variables from every deployment environment and from the
   deployment repository's values. They are removed from
   `deploy/env.contract.yml` with no fallback period:

   - `AI_ADDITIONS_BASE_URL`
   - `AI_ADDITIONS_KEYCLOAK_BASE_URL`
   - `AI_ADDITIONS_KEYCLOAK_TOKEN_URL`
   - `AI_ADDITIONS_POLYADIC_AGENTS_API_BASE_URL`
   - `AI_ADDITIONS_ARGUMENTATION_TUTOR_API_BASE_URL`
   - `AI_ADDITIONS_CASE_ANALYST_API_BASE_URL`
   - `EXTERNAL_SERVICES_CALLBACK_AUTH_ISSUER`
   - `EXTERNAL_SERVICES_CALLBACK_AUTH_JWKS_URL`
   - `EXTERNAL_SERVICES_MANIFEST` (with `manifest.staging.json` and
     `manifest.development.json`, which no longer exist)

   Keep the client credentials and the other variables of the table above.
   Before deleting `AI_ADDITIONS_BASE_URL`, note its value: it becomes the
   connection's `base_url`.
2. Refresh the deployment repository's copy of `deploy/env.contract.yml` from
   the release being deployed.
3. Deploy. Flyway applies V22 (the connection, the policy versions and the
   session pin), V23 (pending callback results) and V24 (room-scoped jobs for
   Polyadic callbacks, which needs no operator action). V22 creates policy
   version 1, which allows nothing, and pins every existing session to it.
4. AI stops at once in every session, including activities that were running
   during the upgrade. They stay without AI permanently, since a pin never
   changes; only activities launched after a policy is saved use AI. Plan the
   upgrade between activities.
5. In `/mng/ai-services`, follow steps 3 to 6 of "Enabling AI": enter the
   connection (the former `AI_ADDITIONS_BASE_URL` as `base_url`), test it
   until the token, issuer and catalog steps pass, save it, allow the
   services, and save a new version.

AI Additions must be on a release that serves the catalog before step 5,
otherwise the catalog step fails with `unreachable` or `invalid_response` and
no service can be allowed.

### Local development

The development Compose stack sets `EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`,
so the mock adapters work without AI Additions. To use a local AI Additions
started from its own repository (NGINX on port 8010), configure the connection
at `http://localhost/mng/ai-services` with
`base_url` `http://host.docker.internal:8010` and `keycloak_public_url`
`http://localhost:8010/keycloak`, its development `KEYCLOAK_PUBLIC_URL`. The
same row can be written with SQL:

```bash
docker compose exec postgresql psql -U postgres -d ethicapp -c \
  "INSERT INTO ai_additions_connection (id, base_url, keycloak_public_url) VALUES (1, 'http://host.docker.internal:8010', 'http://localhost:8010/keycloak') ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, keycloak_public_url = EXCLUDED.keycloak_public_url;"
```

Delete the row (`DELETE FROM ai_additions_connection;`) to stop all AI calls.
The services still need a saved policy version that allows them.

## Publishable Images

The repository can build and publish these project images:

| Service | Context | Default image |
| --- | --- | --- |
| `ethicapp` | repository root (`ethicapp/Dockerfile`) | `ghcr.io/<owner>/ethicapp:<tag>` |
| `external-mock-service` | `external-mock-service/` | `ghcr.io/<owner>/ethicapp-external-mock-service:<tag>` |
| `auth-backend` | `auth-backend/` | `ghcr.io/<owner>/ethicapp-auth-backend:<tag>` |
| `ethicapp-student` | `ethicapp-student/` | `ghcr.io/<owner>/ethicapp-student:<tag>` |
| `management-console` | `management-console/` | `ghcr.io/<owner>/ethicapp-management-console:<tag>` |
| `nginx` | `nginx/` | `ghcr.io/<owner>/ethicapp-nginx:<tag>` |
| `db-migrations` | `database/` | `ghcr.io/<owner>/ethicapp-db-migrations:<tag>` |

The `ethicapp` image includes `database/seeds` from the same source revision.
On startup it runs the semantic tag taxonomy seed from
`/database/seeds/tag-taxonomies` before the web process starts. The seed is
idempotent, so adding or editing tag taxonomy JSON files and publishing a new
`ethicapp` image updates production without manual SQL. To override this
behavior, use `ETHICAPP_SEED_TAG_TAXONOMIES=false` or point
`ETHICAPP_TAG_TAXONOMY_SEED_DIR` at a mounted seed directory.

`db-migrations` is a short-lived Flyway-based image with `database/migrations`
baked into the image. Production deployments should run it before application
services start, using the same PostgreSQL connection variables as the apps.
This avoids requiring a repository checkout or bind-mounted migrations directory
on the production host. The image entrypoint derives `FLYWAY_URL`,
`FLYWAY_USER`, and `FLYWAY_PASSWORD` from `PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER`, `PGPASSWORD`, and `PGSSLMODE`; it also falls back to `POSTGRES_DB`,
`POSTGRES_USER`, and `POSTGRES_PASSWORD` when the migration job receives the
database container env file. Explicit Flyway variables can still override that
mapping.

`external-mock-service` is the repository-provided PoC service used by mock
external-service adapters. Publish it with the full image set so deployment
manifests can pin it, but deploy it only when mock integrations are
intentionally enabled.

The `ethicapp` image ships one external-services adapter catalog,
`backend/external-services/manifest.json` (#812). It is code, not
configuration. No production adapter receives events until an operator stores
an AI Additions connection and allows services in the management console; see
[AI Services (AI Additions)](#ai-services-ai-additions). The mock adapters
need `external-mock-service` and register only with
`EXTERNAL_SERVICES_DEVELOPMENT_ADAPTERS=true`, which only the local Compose
stack sets.

`postgres` and `redis` are not built by this repository. Use the official images
and pin the desired versions in the deployment repository.

## Prerequisites

- Docker with Buildx support.
- A GitHub user or organization where packages should be published.
- A GitHub personal access token or GitHub Actions token with package write permissions.

For local publishing, log in to GHCR before running the script:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin
```

For GitHub Actions, prefer the built-in `GITHUB_TOKEN` with `packages: write` permission.

## Build and Push

Publish all images with a release tag:

```bash
npm run publish:ghcr -- --owner github-org-or-user --tag v2026.05.11
```

Publish all images with both a release tag and `latest`:

```bash
npm run publish:ghcr -- --owner github-org-or-user --tag v2026.05.11 --latest
```

Build only one service:

```bash
npm run publish:ghcr -- --owner github-org-or-user --service auth-backend --tag v2026.05.11
```

Build locally without pushing:

```bash
npm run publish:ghcr -- --owner github-org-or-user --service ethicapp --tag local-test --no-push
```

Preview the Docker commands without running them:

```bash
npm run publish:ghcr -- --owner github-org-or-user --tag v2026.05.11 --dry-run
```

## Configuration

The script accepts CLI options and matching environment variables.

| Option | Environment variable | Default | Description |
| --- | --- | --- | --- |
| `--owner` | `GHCR_OWNER` | GitHub remote owner | GHCR namespace or organization. |
| `--registry` | `REGISTRY` | `ghcr.io` | Container registry host. |
| `--prefix` | `IMAGE_PREFIX` | `ethicapp` | Prefix used for image names. |
| `--tag` | `IMAGE_TAG` | Current git short SHA | Primary tag applied to each image. |
| `--extra-tags` | `ADDITIONAL_TAGS` | Empty | Comma-separated extra tags. |
| `--platforms` | `PLATFORMS` | `linux/amd64` | Buildx target platforms. |
| `--latest` | `TAG_LATEST=true` | `false` | Also tag images as `latest`. |
| `--no-push` | `PUSH=false` | `true` | Load the image locally instead of pushing it. |
| `--dry-run` | `DRY_RUN=true` | `false` | Print commands without running them. |

Multi-platform builds can be published with:

```bash
npm run publish:ghcr -- --owner github-org-or-user --tag v2026.05.11 --platforms linux/amd64,linux/arm64
```

Local `--no-push` builds use `docker buildx --load`, so they support one platform at a time.

## Verification

The `ethicapp` and `management-console` Dockerfiles run backend tests during image build. If those tests fail, the image is not published.

Before promoting images to production, run at least:

```bash
npm run publish:ghcr -- --owner github-org-or-user --tag preflight --no-push --service ethicapp
npm run publish:ghcr -- --owner github-org-or-user --tag preflight --no-push --service management-console
```

For a full release candidate, publish a versioned tag and deploy that exact tag in the deployment repository. Avoid deploying mutable tags such as `latest` as the source of record.

## Deployment Repository Contract

The deployment repository should treat this repository's output as immutable images and provide:

- Production `.env` templates with no secrets committed.
- Runtime infrastructure definitions.
- Volume and backup strategy for PostgreSQL and uploads. Repository-owned
  host-level backups can use the package generated by `npm run backup:package`
  and documented in
  [`deploy/production-backup-runbook.md`](./deploy/production-backup-runbook.md)
  as the baseline daily cron procedure with 7-backup-set retention.
- TLS, domain, and reverse-proxy configuration.
- A promotion process from release candidate tags to production tags.

Keep production secrets in the runtime platform or secret manager, not in this repository.

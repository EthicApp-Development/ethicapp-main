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

Pay special attention to `VITE_*` variables. They are public frontend variables, not secrets. Production images keep frontend bundles environment-neutral; each container writes its frontend `runtime-config.js` from runtime environment variables when it starts.

## Redis Topology

Production deployments use two Redis instances:

- `redis-session`: Express session storage for `ethicapp` and `auth-backend`.
- `redis-cache`: database-derived cache entries used by the legacy `ethicapp` application.

Development keeps a single Redis instance. In development, both `REDIS_SESSION_*` and `REDIS_CACHE_*` point to the same `redis` service.

Use role-specific variables in deployment environments:

```bash
REDIS_SESSION_HOST=redis-session
REDIS_SESSION_PORT=6379
REDIS_CACHE_HOST=redis-cache
REDIS_CACHE_PORT=6379
```

Set Redis container memory limits through the Compose environment:

```bash
REDIS_SESSION_MAXMEMORY=128mb
REDIS_SESSION_MAXMEMORY_POLICY=volatile-ttl
REDIS_CACHE_MAXMEMORY=256mb
REDIS_CACHE_MAXMEMORY_POLICY=allkeys-lru
```

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

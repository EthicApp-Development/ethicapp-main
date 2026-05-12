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
- external images such as Redis.

The deployment repository should copy or render this manifest for each promoted
environment. When only `ethicapp` and `nginx` are rebuilt, those two entries can
move to the new tag while the other services stay pinned to their previous tags.
The contract entry should point to the source ref whose `env.contract.yml`
matches the environment files being rendered.

Pay special attention to `VITE_*` variables. They are public frontend variables and are read when Vite builds frontend assets, not when a container starts. EthicApp uses a per-environment image strategy for these values: build and tag images with the intended public values for the target environment.

## Redis Topology

Production deployments use two Redis instances:

- `redis`: Express session storage for `ethicapp` and `auth-backend`.
- `redis-cache`: database-derived cache entries used by the legacy `ethicapp` application.

Development keeps a single Redis instance. In development, both `REDIS_SESSION_*` and `REDIS_CACHE_*` point to the same `redis` service.

Use role-specific variables in deployment environments:

```bash
REDIS_SESSION_HOST=redis
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

The older `REDIS_HOST`, `REDIS_PORT`, and `REDIS_URL` variables remain as fallbacks for local development and backwards compatibility.

## Publishable Images

The repository can build and publish these project images:

| Service | Context | Default image |
| --- | --- | --- |
| `ethicapp` | `ethicapp/` | `ghcr.io/<owner>/ethicapp:<tag>` |
| `auth-backend` | `auth-backend/` | `ghcr.io/<owner>/ethicapp-auth-backend:<tag>` |
| `ethicapp-student` | `ethicapp-student/` | `ghcr.io/<owner>/ethicapp-student:<tag>` |
| `management-console` | `management-console/` | `ghcr.io/<owner>/ethicapp-management-console:<tag>` |
| `nginx` | `nginx/` | `ghcr.io/<owner>/ethicapp-nginx:<tag>` |
| `database` | `database/` | `ghcr.io/<owner>/ethicapp-database:<tag>` |

`redis` is not built by this repository. Use the official Redis image and pin the desired version in the deployment repository.

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
- Volume and backup strategy for PostgreSQL and uploads.
- TLS, domain, and reverse-proxy configuration.
- A promotion process from release candidate tags to production tags.

Keep production secrets in the runtime platform or secret manager, not in this repository.

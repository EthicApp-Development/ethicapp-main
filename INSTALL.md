# EthicApp Deployment

The production deployment strategy is being redesigned around immutable Docker images. This repository owns image builds. A separate deployment repository can then consume those images through Compose, Kubernetes, or another runtime-specific template.

This document covers the current image publishing flow for GitHub Container Registry (GHCR).

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

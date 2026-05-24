#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REGISTRY="${REGISTRY:-ghcr.io}"
GHCR_OWNER="${GHCR_OWNER:-${GITHUB_REPOSITORY_OWNER:-}}"
IMAGE_PREFIX="${IMAGE_PREFIX:-ethicapp}"
IMAGE_TAG="${IMAGE_TAG:-}"
ADDITIONAL_TAGS="${ADDITIONAL_TAGS:-}"
PLATFORMS="${PLATFORMS:-linux/amd64}"
PUSH="${PUSH:-true}"
TAG_LATEST="${TAG_LATEST:-false}"
DRY_RUN="${DRY_RUN:-false}"
SERVICES=""

usage() {
  cat <<'EOF'
Build and optionally publish EthicApp Docker images to GitHub Container Registry.

Usage:
  scripts/ghcr-build-push.sh [options]

Options:
  --owner OWNER        GHCR namespace or organization. Defaults to GHCR_OWNER,
                       GITHUB_REPOSITORY_OWNER, or the GitHub remote owner.
  --registry URL      Container registry. Default: ghcr.io
  --prefix PREFIX     Image name prefix. Default: ethicapp
  --tag TAG           Primary image tag. Defaults to current git short SHA.
  --extra-tags TAGS   Comma-separated extra tags to publish.
  --platforms LIST    docker buildx platforms. Default: linux/amd64
  --service NAME      Service to build. Can be repeated.
  --all               Build all publishable project images. Default.
  --latest            Also publish the latest tag.
  --no-push           Build locally with --load instead of pushing.
  --dry-run           Print docker commands without running them.
  -h, --help          Show this help.

Services:
  ethicapp
  auth-backend
  ethicapp-student
  management-console
  nginx
  db-migrations

Environment variables mirror the long options:
  REGISTRY, GHCR_OWNER, IMAGE_PREFIX, IMAGE_TAG, ADDITIONAL_TAGS,
  PLATFORMS, PUSH, TAG_LATEST, DRY_RUN
EOF
}

append_service() {
  if [ -z "$SERVICES" ]; then
    SERVICES="$1"
  else
    SERVICES="$SERVICES $1"
  fi
}

default_services() {
  echo "ethicapp auth-backend ethicapp-student management-console nginx db-migrations"
}

service_context() {
  case "$1" in
    ethicapp) echo "ethicapp" ;;
    auth-backend) echo "auth-backend" ;;
    ethicapp-student) echo "ethicapp-student" ;;
    management-console) echo "management-console" ;;
    nginx) echo "nginx" ;;
    db-migrations) echo "database" ;;
    *) return 1 ;;
  esac
}

service_dockerfile() {
  case "$1" in
    ethicapp) echo "ethicapp/Dockerfile" ;;
    auth-backend) echo "auth-backend/Dockerfile" ;;
    ethicapp-student) echo "ethicapp-student/Dockerfile" ;;
    management-console) echo "management-console/Dockerfile" ;;
    nginx) echo "nginx/Dockerfile" ;;
    db-migrations) echo "database/Dockerfile" ;;
    *) return 1 ;;
  esac
}

service_image_name() {
  case "$1" in
    ethicapp) echo "$IMAGE_PREFIX" ;;
    ethicapp-student) echo "$IMAGE_PREFIX-student" ;;
    db-migrations) echo "$IMAGE_PREFIX-db-migrations" ;;
    *) echo "$IMAGE_PREFIX-$1" ;;
  esac
}

infer_github_owner() {
  local remote
  remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  if [ -z "$remote" ]; then
    return 1
  fi

  case "$remote" in
    git@github.com:*)
      remote="${remote#git@github.com:}"
      ;;
    https://github.com/*)
      remote="${remote#https://github.com/}"
      ;;
    ssh://git@github.com/*)
      remote="${remote#ssh://git@github.com/}"
      ;;
    *)
      return 1
      ;;
  esac

  remote="${remote%%/*}"
  if [ -n "$remote" ]; then
    echo "$remote"
  else
    return 1
  fi
}

git_short_sha() {
  git rev-parse --short HEAD 2>/dev/null || date -u '+%Y%m%d%H%M%S'
}

git_revision() {
  git rev-parse HEAD 2>/dev/null || true
}

git_source_url() {
  local remote
  remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  case "$remote" in
    git@github.com:*)
      remote="${remote#git@github.com:}"
      remote="${remote%.git}"
      echo "https://github.com/$remote"
      ;;
    https://github.com/*)
      echo "${remote%.git}"
      ;;
    *)
      echo "$remote"
      ;;
  esac
}

bool_is_true() {
  case "$1" in
    true|TRUE|1|yes|YES|y|Y) return 0 ;;
    *) return 1 ;;
  esac
}

run_cmd() {
  printf '+'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'

  if ! bool_is_true "$DRY_RUN"; then
    "$@"
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --owner)
      GHCR_OWNER="$2"
      shift 2
      ;;
    --registry)
      REGISTRY="$2"
      shift 2
      ;;
    --prefix)
      IMAGE_PREFIX="$2"
      shift 2
      ;;
    --tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --extra-tags)
      ADDITIONAL_TAGS="$2"
      shift 2
      ;;
    --platforms)
      PLATFORMS="$2"
      shift 2
      ;;
    --service)
      append_service "$2"
      shift 2
      ;;
    --all)
      SERVICES="$(default_services)"
      shift
      ;;
    --latest)
      TAG_LATEST="true"
      shift
      ;;
    --no-push)
      PUSH="false"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$SERVICES" ]; then
  SERVICES="$(default_services)"
fi

if [ -z "$GHCR_OWNER" ]; then
  GHCR_OWNER="$(infer_github_owner || true)"
fi

if [ -z "$GHCR_OWNER" ]; then
  echo "Missing GHCR owner. Set GHCR_OWNER or pass --owner." >&2
  exit 1
fi

GHCR_OWNER="$(printf '%s' "$GHCR_OWNER" | tr '[:upper:]' '[:lower:]')"
IMAGE_PREFIX="$(printf '%s' "$IMAGE_PREFIX" | tr '[:upper:]' '[:lower:]')"
REGISTRY="${REGISTRY%/}"

if [ -z "$IMAGE_TAG" ]; then
  IMAGE_TAG="$(git_short_sha)"
fi

if ! bool_is_true "$PUSH" && [ "$PLATFORMS" != "${PLATFORMS%,*}" ]; then
  echo "--no-push uses docker buildx --load and supports only one platform." >&2
  exit 1
fi

CREATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
REVISION="$(git_revision)"
SOURCE_URL="$(git_source_url)"

for service in $SERVICES; do
  context="$(service_context "$service" || true)"
  dockerfile="$(service_dockerfile "$service" || true)"

  if [ -z "$context" ] || [ -z "$dockerfile" ]; then
    echo "Unknown service: $service" >&2
    exit 1
  fi

  image="$REGISTRY/$GHCR_OWNER/$(service_image_name "$service")"
  title="EthicApp $service"

  set -- docker buildx build \
    --platform "$PLATFORMS" \
    --file "$dockerfile" \
    --label "org.opencontainers.image.created=$CREATED_AT" \
    --label "org.opencontainers.image.title=$title" \
    --label "org.opencontainers.image.source=$SOURCE_URL" \
    --label "org.opencontainers.image.revision=$REVISION" \
    --tag "$image:$IMAGE_TAG"

  if [ -n "$ADDITIONAL_TAGS" ]; then
    old_ifs="$IFS"
    IFS=","
    for extra_tag in $ADDITIONAL_TAGS; do
      if [ -n "$extra_tag" ]; then
        set -- "$@" --tag "$image:$extra_tag"
      fi
    done
    IFS="$old_ifs"
  fi

  if bool_is_true "$TAG_LATEST"; then
    set -- "$@" --tag "$image:latest"
  fi

  if bool_is_true "$PUSH"; then
    set -- "$@" --push
  else
    set -- "$@" --load
  fi

  set -- "$@" "$context"

  echo
  echo "Building $service -> $image:$IMAGE_TAG"
  run_cmd "$@"
done

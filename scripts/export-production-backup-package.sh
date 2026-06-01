#!/bin/sh
set -eu

PACKAGE_NAME="${PRODUCTION_BACKUP_PACKAGE_NAME:-ethicapp-production-backup-kit}"
OUTPUT_DIR="${PRODUCTION_BACKUP_PACKAGE_DIR:-dist}"
VERSION="${PRODUCTION_BACKUP_PACKAGE_VERSION:-}"

if [ -z "$VERSION" ]; then
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    VERSION="$(git describe --tags --always --dirty 2>/dev/null || git rev-parse --short HEAD)"
  else
    VERSION="$(date -u +%Y%m%d%H%M%S)"
  fi
fi

ARCHIVE_NAME="$PACKAGE_NAME-$VERSION.tar.gz"
STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/$PACKAGE_NAME.XXXXXX")"
STAGING_DIR="$STAGING_ROOT/$PACKAGE_NAME"

cleanup() {
  rm -rf "$STAGING_ROOT"
}

trap cleanup EXIT HUP INT TERM

mkdir -p "$STAGING_DIR" "$OUTPUT_DIR"

cp scripts/production-backup.sh "$STAGING_DIR/production-backup.sh"
cp scripts/production-restore.sh "$STAGING_DIR/production-restore.sh"
cp deploy/production-backup-package/README.md "$STAGING_DIR/README.md"
cp deploy/production-backup-package/.env.example "$STAGING_DIR/.env.example"

chmod 0750 "$STAGING_DIR/production-backup.sh" "$STAGING_DIR/production-restore.sh"
chmod 0640 "$STAGING_DIR/.env.example"

tar -czf "$OUTPUT_DIR/$ARCHIVE_NAME" -C "$STAGING_ROOT" "$PACKAGE_NAME"

printf 'Production backup package written to %s\n' "$OUTPUT_DIR/$ARCHIVE_NAME"

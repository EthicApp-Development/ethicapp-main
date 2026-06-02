#!/bin/sh
set -eu

DB_DUMP_FILE="${1:-}"
UPLOADS_ARCHIVE="${2:-}"
SCRIPT_NAME="$(basename "$0")"
BACKUP_DB_CONTAINER="${BACKUP_DB_CONTAINER:-${POSTGRES_CONTAINER_NAME:-}}"
UPLOADS_PATH_VALUE="${UPLOADS_PATH:-/app/backend/uploads}"
RESTORE_UPLOADS="${RESTORE_UPLOADS:-true}"
RESTORE_UPLOADS_REPLACE="${RESTORE_UPLOADS_REPLACE:-true}"
PGHOST_VALUE="${PGHOST:-localhost}"
PGPORT_VALUE="${PGPORT:-5432}"
PGUSER_VALUE="${PGUSER:-postgres}"
PGPASSWORD_VALUE="${PGPASSWORD:-}"
PGDATABASE_VALUE="${PGDATABASE:-ethicapp}"
PGSSLMODE_VALUE="${PGSSLMODE:-disable}"
FORCE="${PRODUCTION_RESTORE_FORCE:-false}"

log() {
  printf '%s production-restore: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

usage() {
  cat <<USAGE
Usage:
  ./$SCRIPT_NAME path/to/ethicapp-YYYYMMDD-HHMMSS.dump [path/to/ethicapp-YYYYMMDD-HHMMSS-uploads.tar.gz]

Environment:
  PRODUCTION_RESTORE_FORCE=true
                          Skip the interactive confirmation prompt.
  BACKUP_DB_CONTAINER     Optional PostgreSQL container name for docker exec mode.
  RESTORE_UPLOADS         Whether to restore the uploads archive. Default: true
  RESTORE_UPLOADS_REPLACE Whether to clear UPLOADS_PATH before extracting. Default: true
  UPLOADS_PATH            Protected uploads path to restore. Default: /app/backend/uploads
  PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE
                          PostgreSQL connection variables.
USAGE
}

validate_config() {
  case "$DB_DUMP_FILE" in
    --help|-h|help)
      usage
      exit 0
      ;;
  esac

  if [ -z "$DB_DUMP_FILE" ]; then
    usage
    exit 1
  fi

  if [ ! -f "$DB_DUMP_FILE" ]; then
    fail "Database dump file does not exist: $DB_DUMP_FILE"
  fi

  if [ ! -s "$DB_DUMP_FILE" ]; then
    fail "Database dump file is empty: $DB_DUMP_FILE"
  fi

  if [ -z "$PGPASSWORD_VALUE" ]; then
    fail "PGPASSWORD is required for production restore."
  fi

  case "$RESTORE_UPLOADS" in
    true|false) ;;
    *)
      fail "RESTORE_UPLOADS must be true or false."
      ;;
  esac

  case "$RESTORE_UPLOADS_REPLACE" in
    true|false) ;;
    *)
      fail "RESTORE_UPLOADS_REPLACE must be true or false."
      ;;
  esac

  if [ "$RESTORE_UPLOADS" = "true" ]; then
    if [ -z "$UPLOADS_ARCHIVE" ]; then
      UPLOADS_ARCHIVE="${DB_DUMP_FILE%.dump}-uploads.tar.gz"
    fi

    if [ ! -f "$UPLOADS_ARCHIVE" ]; then
      fail "Uploads archive does not exist: $UPLOADS_ARCHIVE"
    fi

    if [ ! -s "$UPLOADS_ARCHIVE" ]; then
      fail "Uploads archive is empty: $UPLOADS_ARCHIVE"
    fi

    case "$UPLOADS_PATH_VALUE" in
      ''|/)
        fail "UPLOADS_PATH must not be empty or /."
        ;;
    esac
  fi
}

confirm_restore() {
  if [ "$FORCE" = "true" ]; then
    return
  fi

  if [ "$RESTORE_UPLOADS" = "true" ]; then
    printf 'This will replace database %s and uploads at %s. Continue? [y/N]: ' "$PGDATABASE_VALUE" "$UPLOADS_PATH_VALUE"
  else
    printf 'This will replace database %s. Continue? [y/N]: ' "$PGDATABASE_VALUE"
  fi
  read -r response
  case "$response" in
    [yY]|[yY][eE][sS]) ;;
    *)
      log "Restore cancelled."
      exit 0
      ;;
  esac
}

check_container() {
  command -v docker >/dev/null 2>&1 || fail "docker is required when BACKUP_DB_CONTAINER is set."

  if ! RUNNING_CONTAINERS="$(docker ps --format '{{.Names}}')"; then
    fail "Unable to query Docker containers. Is Docker running and accessible?"
  fi

  if ! printf '%s\n' "$RUNNING_CONTAINERS" | grep -qx "$BACKUP_DB_CONTAINER"; then
    fail "Container $BACKUP_DB_CONTAINER is not running."
  fi
}

restore_with_container() {
  check_container

  docker exec \
    -e PGPASSWORD="$PGPASSWORD_VALUE" \
    -e PGSSLMODE="$PGSSLMODE_VALUE" \
    "$BACKUP_DB_CONTAINER" \
    dropdb \
      --host="$PGHOST_VALUE" \
      --port="$PGPORT_VALUE" \
      --username="$PGUSER_VALUE" \
      --force \
      --if-exists \
      "$PGDATABASE_VALUE"

  docker exec \
    -e PGPASSWORD="$PGPASSWORD_VALUE" \
    -e PGSSLMODE="$PGSSLMODE_VALUE" \
    "$BACKUP_DB_CONTAINER" \
    createdb \
      --host="$PGHOST_VALUE" \
      --port="$PGPORT_VALUE" \
      --username="$PGUSER_VALUE" \
      "$PGDATABASE_VALUE"

  docker exec -i \
    -e PGPASSWORD="$PGPASSWORD_VALUE" \
    -e PGSSLMODE="$PGSSLMODE_VALUE" \
    "$BACKUP_DB_CONTAINER" \
    pg_restore \
      --host="$PGHOST_VALUE" \
      --port="$PGPORT_VALUE" \
      --username="$PGUSER_VALUE" \
      --dbname="$PGDATABASE_VALUE" \
      --no-owner \
      --no-privileges \
      --clean \
      --if-exists \
    < "$DB_DUMP_FILE"
}

restore_direct() {
  command -v dropdb >/dev/null 2>&1 || fail "dropdb is not installed or not in PATH."
  command -v createdb >/dev/null 2>&1 || fail "createdb is not installed or not in PATH."
  command -v pg_restore >/dev/null 2>&1 || fail "pg_restore is not installed or not in PATH."

  PGPASSWORD="$PGPASSWORD_VALUE" PGSSLMODE="$PGSSLMODE_VALUE" \
    dropdb \
      --host="$PGHOST_VALUE" \
      --port="$PGPORT_VALUE" \
      --username="$PGUSER_VALUE" \
      --force \
      --if-exists \
      "$PGDATABASE_VALUE"

  PGPASSWORD="$PGPASSWORD_VALUE" PGSSLMODE="$PGSSLMODE_VALUE" \
    createdb \
      --host="$PGHOST_VALUE" \
      --port="$PGPORT_VALUE" \
      --username="$PGUSER_VALUE" \
      "$PGDATABASE_VALUE"

  PGPASSWORD="$PGPASSWORD_VALUE" PGSSLMODE="$PGSSLMODE_VALUE" \
    pg_restore \
      --host="$PGHOST_VALUE" \
      --port="$PGPORT_VALUE" \
      --username="$PGUSER_VALUE" \
      --dbname="$PGDATABASE_VALUE" \
      --no-owner \
      --no-privileges \
      --clean \
      --if-exists \
      "$DB_DUMP_FILE"
}

restore_uploads() {
  if [ "$RESTORE_UPLOADS" != "true" ]; then
    log "Uploads restore disabled by RESTORE_UPLOADS=false."
    return
  fi

  command -v tar >/dev/null 2>&1 || fail "tar is not installed or not in PATH."
  mkdir -p "$UPLOADS_PATH_VALUE"

  if [ "$RESTORE_UPLOADS_REPLACE" = "true" ]; then
    log "Clearing existing uploads in $UPLOADS_PATH_VALUE."
    find "$UPLOADS_PATH_VALUE" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  fi

  log "Restoring uploads from $UPLOADS_ARCHIVE into $UPLOADS_PATH_VALUE."
  tar -xzf "$UPLOADS_ARCHIVE" -C "$UPLOADS_PATH_VALUE"
  log "Uploads restored successfully from $UPLOADS_ARCHIVE."
}

validate_config
confirm_restore

log "Starting restore into database $PGDATABASE_VALUE from $DB_DUMP_FILE."

if [ -n "$BACKUP_DB_CONTAINER" ]; then
  restore_with_container
else
  restore_direct
fi

log "Database restored successfully from $DB_DUMP_FILE."
restore_uploads

#!/bin/sh
set -eu

COMMAND="${1:-backup}"
SCRIPT_NAME="$(basename "$0")"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ethicapp}"
BACKUP_PREFIX="${BACKUP_PREFIX:-ethicapp}"
BACKUP_RETENTION_COUNT="${BACKUP_RETENTION_COUNT:-7}"
BACKUP_DB_CONTAINER="${BACKUP_DB_CONTAINER:-${POSTGRES_CONTAINER_NAME:-}}"
UPLOADS_PATH_VALUE="${UPLOADS_PATH:-/app/backend/uploads}"
BACKUP_UPLOADS="${BACKUP_UPLOADS:-true}"
PGHOST_VALUE="${PGHOST:-localhost}"
PGPORT_VALUE="${PGPORT:-5432}"
PGUSER_VALUE="${PGUSER:-postgres}"
PGPASSWORD_VALUE="${PGPASSWORD:-}"
PGDATABASE_VALUE="${PGDATABASE:-ethicapp}"
PGSSLMODE_VALUE="${PGSSLMODE:-disable}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
DUMP_FILE="$BACKUP_DIR/$BACKUP_PREFIX-$TIMESTAMP.dump"
UPLOADS_FILE="$BACKUP_DIR/$BACKUP_PREFIX-$TIMESTAMP-uploads.tar.gz"
TMP_DUMP_FILE="$DUMP_FILE.incomplete.$$"
TMP_UPLOADS_FILE="$UPLOADS_FILE.incomplete.$$"

log() {
  printf '%s production-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

usage() {
  cat <<USAGE
Usage:
  ./$SCRIPT_NAME [backup]
  ./$SCRIPT_NAME prune

Environment:
  BACKUP_DIR              Backup directory. Default: /var/backups/ethicapp
  BACKUP_PREFIX           Backup filename prefix. Default: ethicapp
  BACKUP_RETENTION_COUNT  Number of script-created backups to keep. Default: 7
  BACKUP_DB_CONTAINER     Optional PostgreSQL container name for docker exec mode.
  BACKUP_UPLOADS          Whether to back up UPLOADS_PATH. Default: true
  UPLOADS_PATH            Protected uploads path to archive. Default: /app/backend/uploads
  PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE
                          PostgreSQL connection variables.
USAGE
}

validate_config() {
  case "$BACKUP_PREFIX" in
    ''|*/*|*[!A-Za-z0-9._-]*)
      fail "BACKUP_PREFIX must contain only letters, numbers, dot, underscore, or hyphen."
      ;;
  esac

  case "$BACKUP_RETENTION_COUNT" in
    ''|*[!0-9]*)
      fail "BACKUP_RETENTION_COUNT must be a non-negative integer."
      ;;
  esac

  if [ "$COMMAND" = "backup" ] && [ -z "$PGPASSWORD_VALUE" ]; then
    fail "PGPASSWORD is required for production backups."
  fi

  case "$BACKUP_UPLOADS" in
    true|false) ;;
    *)
      fail "BACKUP_UPLOADS must be true or false."
      ;;
  esac
}

run_pg_dump() {
  if [ -n "$BACKUP_DB_CONTAINER" ]; then
    command -v docker >/dev/null 2>&1 || fail "docker is required when BACKUP_DB_CONTAINER is set."

    if ! RUNNING_CONTAINERS="$(docker ps --format '{{.Names}}')"; then
      fail "Unable to query Docker containers. Is Docker running and accessible?"
    fi

    if ! printf '%s\n' "$RUNNING_CONTAINERS" | grep -qx "$BACKUP_DB_CONTAINER"; then
      fail "Container $BACKUP_DB_CONTAINER is not running."
    fi

    docker exec \
      -e PGPASSWORD="$PGPASSWORD_VALUE" \
      -e PGSSLMODE="$PGSSLMODE_VALUE" \
      "$BACKUP_DB_CONTAINER" \
      pg_dump \
        --host="$PGHOST_VALUE" \
        --port="$PGPORT_VALUE" \
        --username="$PGUSER_VALUE" \
        --dbname="$PGDATABASE_VALUE" \
        --no-owner \
        --no-privileges \
        --format=custom \
      > "$TMP_DUMP_FILE"
    return
  fi

  command -v pg_dump >/dev/null 2>&1 || fail "pg_dump is not installed or not in PATH."

  PGPASSWORD="$PGPASSWORD_VALUE" PGSSLMODE="$PGSSLMODE_VALUE" \
    pg_dump \
      --host="$PGHOST_VALUE" \
      --port="$PGPORT_VALUE" \
      --username="$PGUSER_VALUE" \
      --dbname="$PGDATABASE_VALUE" \
      --no-owner \
      --no-privileges \
      --format=custom \
    > "$TMP_DUMP_FILE"
}

create_uploads_archive() {
  if [ "$BACKUP_UPLOADS" != "true" ]; then
    log "Uploads backup disabled by BACKUP_UPLOADS=false."
    return
  fi

  command -v tar >/dev/null 2>&1 || fail "tar is not installed or not in PATH."

  if [ ! -d "$UPLOADS_PATH_VALUE" ]; then
    fail "UPLOADS_PATH does not exist or is not a directory: $UPLOADS_PATH_VALUE"
  fi

  log "Starting uploads backup from $UPLOADS_PATH_VALUE."
  tar -czf "$TMP_UPLOADS_FILE" -C "$UPLOADS_PATH_VALUE" .

  if [ ! -s "$TMP_UPLOADS_FILE" ]; then
    fail "Uploads backup command completed but produced an empty artifact."
  fi

  log "Uploads backup archive created successfully."
}

prune_backups() {
  mkdir -p "$BACKUP_DIR"

  if [ "$BACKUP_RETENTION_COUNT" -eq 0 ]; then
    log "Retention count is 0; pruning all matching backups."
  fi

  MATCHING_FILES="$(find "$BACKUP_DIR" -maxdepth 1 -type f \
    -name "$BACKUP_PREFIX-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].dump" \
    -print | sort)"

  if [ -z "$MATCHING_FILES" ]; then
    log "No matching backups found for pruning in $BACKUP_DIR."
    return
  fi

  MATCHING_COUNT="$(printf '%s\n' "$MATCHING_FILES" | sed '/^$/d' | wc -l | tr -d ' ')"
  DELETE_COUNT=$((MATCHING_COUNT - BACKUP_RETENTION_COUNT))

  if [ "$DELETE_COUNT" -le 0 ]; then
    log "Retention satisfied: $MATCHING_COUNT matching backup(s), keeping $BACKUP_RETENTION_COUNT."
    return
  fi

  log "Pruning $DELETE_COUNT old backup set(s); $MATCHING_COUNT matching database backup(s), keeping $BACKUP_RETENTION_COUNT."
  printf '%s\n' "$MATCHING_FILES" | sed '/^$/d' | head -n "$DELETE_COUNT" | while IFS= read -r old_backup; do
    old_uploads="${old_backup%.dump}-uploads.tar.gz"
    if rm -f "$old_backup"; then
      log "Pruned old backup: $old_backup"
    else
      fail "Unable to prune old backup: $old_backup"
    fi

    if [ -f "$old_uploads" ]; then
      if rm -f "$old_uploads"; then
        log "Pruned old uploads backup: $old_uploads"
      else
        fail "Unable to prune old uploads backup: $old_uploads"
      fi
    fi
  done
}

create_backup() {
  mkdir -p "$BACKUP_DIR"
  trap 'rm -f "$TMP_DUMP_FILE" "$TMP_UPLOADS_FILE"' EXIT HUP INT TERM

  log "Starting PostgreSQL backup for database $PGDATABASE_VALUE."
  run_pg_dump

  if [ ! -s "$TMP_DUMP_FILE" ]; then
    fail "Backup command completed but produced an empty artifact."
  fi

  create_uploads_archive

  mv "$TMP_DUMP_FILE" "$DUMP_FILE"
  if [ "$BACKUP_UPLOADS" = "true" ]; then
    mv "$TMP_UPLOADS_FILE" "$UPLOADS_FILE"
  fi

  BACKUP_SIZE="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
  log "Database backup completed successfully."
  log "Database backup path: $DUMP_FILE"
  log "Database backup size bytes: $BACKUP_SIZE"

  if [ "$BACKUP_UPLOADS" = "true" ]; then
    UPLOADS_SIZE="$(wc -c < "$UPLOADS_FILE" | tr -d ' ')"
    log "Uploads backup completed successfully."
    log "Uploads backup path: $UPLOADS_FILE"
    log "Uploads backup size bytes: $UPLOADS_SIZE"
  fi

  trap - EXIT HUP INT TERM
  prune_backups
}

case "$COMMAND" in
  backup)
    validate_config
    create_backup
    ;;
  prune)
    validate_config
    prune_backups
    ;;
  --help|-h|help)
    usage
    ;;
  *)
    usage
    fail "Unknown command: $COMMAND"
    ;;
esac

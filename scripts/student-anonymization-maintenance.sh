#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

for env_file in .env.shared .env; do
  if [ -f "$env_file" ]; then
    set -a
    . "./$env_file"
    set +a
  fi
done

APP_SERVICES="${ANONYMIZATION_APP_SERVICES:-ethicapp ethicapp-student auth-backend management-console}"
DB_SERVICE="${ANONYMIZATION_DB_SERVICE:-postgresql}"
DB_USER="${ANONYMIZATION_DB_USER:-${PGUSER:-postgres}}"
DB_NAME="${ANONYMIZATION_DB_NAME:-${PGDATABASE:-${POSTGRES_DB:-ethicapp}}}"
JOB_SERVICE="${ANONYMIZATION_JOB_SERVICE:-management-console-student-anonymization}"
WINDOW_SCHEDULE="${STUDENT_ANONYMIZATION_WINDOW_SCHEDULE:-01-01,07-01}"
WINDOW_TIMEZONE="${STUDENT_ANONYMIZATION_WINDOW_TIMEZONE:-deployment-local}"
WINDOW_LABEL="${STUDENT_ANONYMIZATION_WINDOW_LABEL:-manual}"
TRIGGERED_BY="${STUDENT_ANONYMIZATION_TRIGGERED_BY:-maintenance-window}"
RETRY_AFTER="${NGINX_MAINTENANCE_RETRY_AFTER:-3600}"

usage() {
  cat <<'EOF'
Usage:
  scripts/student-anonymization-maintenance.sh preflight
  scripts/student-anonymization-maintenance.sh enter-maintenance
  scripts/student-anonymization-maintenance.sh dry-run
  scripts/student-anonymization-maintenance.sh execute
  scripts/student-anonymization-maintenance.sh post-check
  scripts/student-anonymization-maintenance.sh restore

Safety:
  execute requires CONFIRM_STUDENT_ANONYMIZATION=true.

Config:
  STUDENT_ANONYMIZATION_WINDOW_SCHEDULE   Default: 01-01,07-01
  STUDENT_ANONYMIZATION_WINDOW_TIMEZONE   Default: deployment-local
  STUDENT_ANONYMIZATION_WINDOW_LABEL      Default: manual
  STUDENT_ANONYMIZATION_TRIGGERED_BY      Default: maintenance-window
  NGINX_MAINTENANCE_RETRY_AFTER           Default: 3600
EOF
}

log() {
  printf '%s\n' "[student-anonymization-maintenance] $*"
}

compose() {
  docker compose "$@"
}

run_sql() {
  compose exec -T "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

wait_for_database() {
  attempts=1
  max_attempts="${ANONYMIZATION_DB_READY_ATTEMPTS:-30}"

  while [ "$attempts" -le "$max_attempts" ]; do
    if compose exec -T "$DB_SERVICE" pg_isready -U "$DB_USER" -d "$DB_NAME"; then
      return 0
    fi

    log "Database is not ready yet. Attempt $attempts/$max_attempts."
    attempts=$((attempts + 1))
    sleep 2
  done

  log "Database did not become ready after $max_attempts attempts."
  return 1
}

show_window_config() {
  log "Configured maintenance schedule: $WINDOW_SCHEDULE"
  log "Configured maintenance timezone: $WINDOW_TIMEZONE"
  log "Current window label: $WINDOW_LABEL"
}

target_count() {
  run_sql -tAc "SELECT count(*) FROM users WHERE role = 'A' AND anonymized_at IS NULL;" | tr -d '[:space:]'
}

preflight() {
  show_window_config
  log "Starting database service if needed."
  compose up -d "$DB_SERVICE"

  log "Checking database reachability."
  wait_for_database

  log "Validating Flyway migration state."
  if ! compose run --rm flyway validate; then
    log "Flyway validation failed. Apply pending migrations before the maintenance window."
    log "For local Compose, run: npm run db:migrate"
    return 1
  fi

  count="$(target_count)"
  log "Student accounts eligible for anonymization: $count"
}

enter_maintenance() {
  log "Stopping application services: $APP_SERVICES"
  compose stop $APP_SERVICES

  log "Starting NGINX in maintenance mode."
  NGINX_MAINTENANCE_MODE=true \
  NGINX_MAINTENANCE_RETRY_AFTER="$RETRY_AFTER" \
    compose up -d --build nginx

  log "Validating active NGINX configuration."
  compose exec -T nginx nginx -t
  compose exec -T nginx sh -c 'grep -q "/static/maintenance/index.html" /etc/nginx/conf.d/default.conf'
  log "Maintenance mode should now serve 503 on app routes and 200 on /healthz and /readyz."
}

run_anonymization_job() {
  dry_run="$1"

  if [ "$dry_run" = "false" ] && [ "${CONFIRM_STUDENT_ANONYMIZATION:-false}" != "true" ]; then
    log "Refusing real anonymization without CONFIRM_STUDENT_ANONYMIZATION=true."
    exit 2
  fi

  log "Running student anonymization job. dry_run=$dry_run"
  compose run --rm \
    -e STUDENT_ANONYMIZATION_DRY_RUN="$dry_run" \
    -e STUDENT_ANONYMIZATION_TRIGGERED_BY="$TRIGGERED_BY" \
    -e STUDENT_ANONYMIZATION_PROCESS_NAME="maintenance-window-$WINDOW_LABEL" \
    "$JOB_SERVICE"
}

post_check() {
  log "Latest anonymization runs:"
  run_sql -c "
    SELECT id,
           status,
           dry_run,
           total_accounts,
           succeeded_accounts,
           failed_accounts,
           started_at,
           finished_at
    FROM student_anonymization_runs
    ORDER BY id DESC
    LIMIT 5;
  "

  log "Remaining non-anonymized student accounts:"
  target_count

  log "Compose service state:"
  compose ps
}

restore() {
  log "Starting application services."
  compose up -d $APP_SERVICES

  log "Restarting NGINX in normal mode."
  NGINX_MAINTENANCE_MODE=false compose up -d --build nginx
  compose exec -T nginx nginx -t
  if compose exec -T nginx sh -c 'grep -q "/static/maintenance/index.html" /etc/nginx/conf.d/default.conf'; then
    log "NGINX still appears to be in maintenance mode after restore."
    exit 1
  fi
  log "Normal service restoration requested."
}

command="${1:-}"

case "$command" in
  preflight)
    preflight
    ;;
  enter-maintenance)
    preflight
    enter_maintenance
    ;;
  dry-run)
    preflight
    enter_maintenance
    run_anonymization_job true
    post_check
    ;;
  execute)
    preflight
    enter_maintenance
    run_anonymization_job false
    post_check
    ;;
  post-check)
    post_check
    ;;
  restore)
    restore
    post_check
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac

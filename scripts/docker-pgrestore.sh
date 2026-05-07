#!/bin/sh
set -eu

CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-ethicapp-db}"
PGUSER_VALUE="${PGUSER:-postgres}"
PGPASSWORD_VALUE="${PGPASSWORD:-postgres}"
PGDATABASE_VALUE="${PGDATABASE:-ethicapp}"
DUMP_FILE="${1:-}"
FORCE="${PGRESTORE_FORCE:-false}"

if [ -z "$DUMP_FILE" ]; then
  echo "Usage: npm run pgrestore -- path/to/dump.dump"
  exit 1
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "Dump file $DUMP_FILE does not exist."
  exit 1
fi

if ! RUNNING_CONTAINERS="$(docker ps --format '{{.Names}}')"; then
  echo "Unable to query Docker containers. Is Docker running and accessible?"
  exit 1
fi

if ! printf '%s\n' "$RUNNING_CONTAINERS" | grep -qx "$CONTAINER_NAME"; then
  echo "Container $CONTAINER_NAME is not running."
  exit 1
fi

if [ "$FORCE" != "true" ]; then
  printf "This will replace database %s in container %s. Continue? [y/N]: " "$PGDATABASE_VALUE" "$CONTAINER_NAME"
  read -r response
  case "$response" in
    [yY]|[yY][eE][sS]) ;;
    *)
      echo "Restore cancelled."
      exit 0
      ;;
  esac
fi

docker exec \
  -e PGPASSWORD="$PGPASSWORD_VALUE" \
  "$CONTAINER_NAME" \
  psql \
    --host=localhost \
    --port=5432 \
    --username="$PGUSER_VALUE" \
    --dbname=postgres \
    --set=ON_ERROR_STOP=1 \
    --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PGDATABASE_VALUE' AND pid <> pg_backend_pid();"

docker exec \
  -e PGPASSWORD="$PGPASSWORD_VALUE" \
  "$CONTAINER_NAME" \
  dropdb \
    --host=localhost \
    --port=5432 \
    --username="$PGUSER_VALUE" \
    --if-exists \
    "$PGDATABASE_VALUE"

docker exec \
  -e PGPASSWORD="$PGPASSWORD_VALUE" \
  "$CONTAINER_NAME" \
  createdb \
    --host=localhost \
    --port=5432 \
    --username="$PGUSER_VALUE" \
    "$PGDATABASE_VALUE"

docker exec -i \
  -e PGPASSWORD="$PGPASSWORD_VALUE" \
  "$CONTAINER_NAME" \
  pg_restore \
    --host=localhost \
    --port=5432 \
    --username="$PGUSER_VALUE" \
    --dbname="$PGDATABASE_VALUE" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
  < "$DUMP_FILE"

echo "Database restored from $DUMP_FILE"

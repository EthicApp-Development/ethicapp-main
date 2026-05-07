#!/bin/sh
set -eu

CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-ethicapp-db}"
PGUSER_VALUE="${PGUSER:-postgres}"
PGPASSWORD_VALUE="${PGPASSWORD:-postgres}"
PGDATABASE_VALUE="${PGDATABASE:-ethicapp}"
DUMP_DIR="${PGDUMP_DIR:-./database/dumps}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="${1:-$DUMP_DIR/$PGDATABASE_VALUE-$TIMESTAMP.dump}"

if ! RUNNING_CONTAINERS="$(docker ps --format '{{.Names}}')"; then
  echo "Unable to query Docker containers. Is Docker running and accessible?"
  exit 1
fi

if ! printf '%s\n' "$RUNNING_CONTAINERS" | grep -qx "$CONTAINER_NAME"; then
  echo "Container $CONTAINER_NAME is not running."
  exit 1
fi

mkdir -p "$(dirname "$DUMP_FILE")"

docker exec \
  -e PGPASSWORD="$PGPASSWORD_VALUE" \
  "$CONTAINER_NAME" \
  pg_dump \
    --host=localhost \
    --port=5432 \
    --username="$PGUSER_VALUE" \
    --dbname="$PGDATABASE_VALUE" \
    --no-owner \
    --no-privileges \
    --format=custom \
  > "$DUMP_FILE"

echo "Database dump written to $DUMP_FILE"

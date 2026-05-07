#!/bin/sh
set -eu

CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-ethicapp-db}"
PGUSER_VALUE="${PGUSER:-postgres}"
PGPASSWORD_VALUE="${PGPASSWORD:-postgres}"
PGDATABASE_VALUE="${PGDATABASE:-ethicapp}"

if ! RUNNING_CONTAINERS="$(docker ps --format '{{.Names}}')"; then
  echo "Unable to query Docker containers. Is Docker running and accessible?"
  exit 1
fi

if ! printf '%s\n' "$RUNNING_CONTAINERS" | grep -qx "$CONTAINER_NAME"; then
  echo "Container $CONTAINER_NAME is not running."
  exit 1
fi

exec docker exec -it \
  -e PGPASSWORD="$PGPASSWORD_VALUE" \
  "$CONTAINER_NAME" \
  psql \
    --host=localhost \
    --port=5432 \
    --username="$PGUSER_VALUE" \
    --dbname="$PGDATABASE_VALUE"

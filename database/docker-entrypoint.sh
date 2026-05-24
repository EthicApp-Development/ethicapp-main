#!/bin/sh
set -eu

: "${PGHOST:=postgresql}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=${POSTGRES_DB:-ethicapp}}"
: "${PGUSER:=${POSTGRES_USER:-postgres}}"
: "${PGSSLMODE:=disable}"
: "${FLYWAY_CONNECT_RETRIES:=60}"

if [ -z "${FLYWAY_URL:-}" ]; then
  FLYWAY_URL="jdbc:postgresql://${PGHOST}:${PGPORT}/${PGDATABASE}?sslmode=${PGSSLMODE}"
  export FLYWAY_URL
fi

if [ -z "${FLYWAY_USER:-}" ]; then
  FLYWAY_USER="$PGUSER"
  export FLYWAY_USER
fi

if [ -z "${PGPASSWORD:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
  PGPASSWORD="$POSTGRES_PASSWORD"
  export PGPASSWORD
fi

if [ -z "${FLYWAY_PASSWORD:-}" ] && [ -n "${PGPASSWORD:-}" ]; then
  FLYWAY_PASSWORD="$PGPASSWORD"
  export FLYWAY_PASSWORD
fi

export FLYWAY_CONNECT_RETRIES

exec flyway "$@"

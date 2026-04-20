#!/bin/sh
set -e

echo "🚀 Starting auth-backend..."

PGHOST="${PGHOST:-postgresql}"
PGPORT="${PGPORT:-5432}"

if [ "$WAIT_FOR_DB" = "true" ]; then
  echo "⏳ Waiting for database at ${PGHOST}:${PGPORT}..."
  until nc -z "$PGHOST" "$PGPORT"; do
    sleep 1
  done
  echo "✔ Database is up"
fi

if [ "$CREATE_ADMIN" = "true" ]; then
  echo "👤 Creating admin user..."
  node scripts/create-admin.js || true
fi

if [ "$SEED_USERS" = "true" ]; then
  echo "🌱 Seeding test users..."
  node scripts/seed-users.js || true
fi

echo "🚀 Launching server..."
exec "$@"
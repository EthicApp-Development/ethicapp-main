#!/bin/sh

set -e

echo "🚀 Starting auth-backend..."

# Esperar DB (opcional pero recomendable)
if [ "$WAIT_FOR_DB" = "true" ]; then
  echo "⏳ Waiting for database..."
  until nc -z "$PGHOST" "$PGPORT"; do
    sleep 1
  done
  echo "✔ Database is up"
fi

# Crear admin si corresponde
if [ "$CREATE_ADMIN" = "true" ]; then
  echo "👤 Creating admin user..."
  node scripts/create-admin.js || true
fi

# Crear usuarios de prueba
if [ "$SEED_USERS" = "true" ]; then
  echo "🌱 Seeding test users..."
  node scripts/seed-users.js || true
fi

# Iniciar aplicación
echo "🚀 Launching server..."
exec node server.js
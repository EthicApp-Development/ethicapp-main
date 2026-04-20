#!/bin/bash
set -e

# Parámetros del entorno
DB_NAME="${POSTGRES_DB:-ethicapp}"
DB_USER="${PGUSER:-postgres}"
DB_PASS="${PGPASSWORD:-postgres}"
DB_HOST="localhost"

echo "Esperando a que PostgreSQL inicie..."
# Ejecuta el proceso de postgres en segundo plano
docker-entrypoint.sh postgres &

# Espera hasta que postgres esté aceptando conexiones
until pg_isready -U "$DB_USER" > /dev/null 2>&1; do
  echo "Esperando conexión a postgres..."
  sleep 1
done

# Verifica si la base de datos existe
echo "Verificando si la base de datos '$DB_NAME' ya existe..."
DB_EXISTS=$(psql -U "$DB_USER" -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")

if [ "$DB_EXISTS" = "1" ]; then
  echo "La base de datos '$DB_NAME' ya existe. No se hace nada."
else
  echo "Creando base de datos '$DB_NAME'..."
  createdb -U "$DB_USER" "$DB_NAME"

  echo "Inicializando base con scripts create_*.sql..."
  for f in /docker-entrypoint-initdb.d/create_*.sql; do
    echo "Ejecutando $f..."
    psql -U "$DB_USER" -d "$DB_NAME" -f "$f"
  done
fi

# Espera a que postgres finalice (quedará corriendo en foreground)
wait

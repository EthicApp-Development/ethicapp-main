#!/bin/bash -e
# --------------------------------------------------------------------------------------------------
# Inicializa el volumen compartido para la base de datos de prueba de PostgreSQL.
# --------------------------------------------------------------------------------------------------

# Cargar variables de entorno
source .env

# Definir variables específicas para pruebas
TEST_DB_VOLUME_PATH="./db-test-data-volume"
TEST_COMPOSE_FILE="docker-compose.test.yml"
POSTGRES_SERVICE="test-postgres"
POSTGRES_CONTAINER="ethicapp-test-postgres"

# Verificar si el directorio ya existe
if test -d ${TEST_DB_VOLUME_PATH}; then
  echo "[WARNING] El directorio \"${TEST_DB_VOLUME_PATH}\" ya existe. Se eliminará y recreará."
  rm -rf ${TEST_DB_VOLUME_PATH}
fi

# Crear un archivo docker-compose temporal sin el volumen montado
TempComposeFilePath="./.docker-compose.test-no-volume.temp"
echo "# ----
# ARCHIVO GENERADO TEMPORALMENTE
# ----
version: \"3.9\"

services:
  # Base de datos PostgreSQL para pruebas
  ${POSTGRES_SERVICE}:
    container_name: \"${POSTGRES_CONTAINER}\"
    image: postgres:14
    environment:
      POSTGRES_DB: ethicapp_test
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - \"5440:5432\"
    healthcheck:
      test: [\"CMD-SHELL\", \"pg_isready -U postgres\"]
      interval: 5s
      timeout: 5s
      retries: 5" > ${TempComposeFilePath}

# Iniciar PostgreSQL sin el volumen montado
echo "[INFO] Iniciando PostgreSQL sin volumen montado..."
docker-compose -f ${TempComposeFilePath} down --remove-orphans
docker-compose -f ${TempComposeFilePath} up -d ${POSTGRES_SERVICE}

# Esperar a que PostgreSQL esté listo
echo "[INFO] Esperando a que PostgreSQL esté listo..."
until docker exec ${POSTGRES_CONTAINER} pg_isready -U postgres > /dev/null 2>&1; do
  echo "Esperando..."
  sleep 2
done

# Verificar que la base de datos existe
echo "[INFO] Verificando conexión a la base de datos..."
docker exec ${POSTGRES_CONTAINER} psql -U postgres -c "\conninfo"

# Crear directorio para el volumen
echo "[INFO] Exportando archivos de base de datos al host..."
mkdir -p ${TEST_DB_VOLUME_PATH}

# Copiar los archivos de la base de datos al host
docker cp ${POSTGRES_CONTAINER}:/var/lib/postgresql/data/ ${TEST_DB_VOLUME_PATH}
mv ${TEST_DB_VOLUME_PATH}/data/* ${TEST_DB_VOLUME_PATH}
rm -R -v ${TEST_DB_VOLUME_PATH}/data/ 2>/dev/null || true

# Detener el contenedor temporal
docker-compose -f ${TempComposeFilePath} down

# Modificar docker-compose.test.yml para usar el volumen
echo "[INFO] Actualizando docker-compose.test.yml para usar el volumen..."
sed -i.bak "s|postgres_test_data:/var/lib/postgresql/data|${TEST_DB_VOLUME_PATH}:/var/lib/postgresql/data:rw|g" ${TEST_COMPOSE_FILE}
# Restaurar el archivo de backup si la sustitución falla
if [ $? -ne 0 ]; then
  echo "[ERROR] No se pudo actualizar el archivo docker-compose.test.yml"
  if [ -f "${TEST_COMPOSE_FILE}.bak" ]; then
    mv "${TEST_COMPOSE_FILE}.bak" "${TEST_COMPOSE_FILE}"
  fi
  exit 1
fi
# Eliminar el archivo de backup si la sustitución fue exitosa
rm -f "${TEST_COMPOSE_FILE}.bak"

# Iniciar los contenedores con el volumen montado
echo "[INFO] Iniciando contenedores con el volumen montado..."
docker-compose -f ${TEST_COMPOSE_FILE} down --remove-orphans
docker-compose -f ${TEST_COMPOSE_FILE} up -d

# Esperar a que PostgreSQL esté listo
echo "[INFO] Esperando a que PostgreSQL esté listo..."
until docker exec ${POSTGRES_CONTAINER} pg_isready -U postgres > /dev/null 2>&1; do
  echo "Esperando..."
  sleep 2
done

# Verificar que la base de datos está lista
echo "[INFO] Verificando que la base de datos está lista..."
docker exec ${POSTGRES_CONTAINER} psql -U postgres -c "\conninfo"

# Eliminar el archivo temporal
rm ${TempComposeFilePath}

echo "[OK] Servicio PostgreSQL iniciado correctamente con volumen en ${TEST_DB_VOLUME_PATH}"
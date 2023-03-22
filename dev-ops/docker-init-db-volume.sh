#!/bin/bash -eu
# --------------------------------------------------------------------------------------------------
# Initializes the shared volume for the Postgres database in the host filesystem.
# --------------------------------------------------------------------------------------------------

source .env

newVolPath=./db-data-volume-v2

if test -d ${newVolPath}; then
    echo "[ERROR] Directory \"${newVolPath}\" already exists in your machine, you seem to have \
already initialized the Postgres shared volume." >&2
    exit 1
fi;

#*
#* Step (1): start Postgres without shared volume mount (i.e. with proper schema and dev data).
#*
HOST_DB_VOLUME_PATH=

TempComposeFilePath=./.docker-compose.REWRITTEN.yml
ComposeRewriteFlags="--file ${TempComposeFilePath}"

# Manually rewriting compose file, as usual docker-compose overrides can't undo an existing
# property, see https://github.com/docker/compose/issues/3729
touch ${TempComposeFilePath} #* not needed
echo "# ----
# GENERATED FILE FROM $0
# ----" > ${TempComposeFilePath}
sed 's^- "./db-data-volume:/var/lib/postgresql/${POSTGRES_VERSION}/main:rw"^[]^g' \
    ./docker-compose.yml >> ${TempComposeFilePath}
#! PROBLEM DETECTED: THIS SED DOES NOT SEEM TO WORK...

docker-compose ${ComposeRewriteFlags} config 1> /dev/null

# Here, we also start PgAdmin service, as a trick for ensuring the `up` command does not return
# until the Postgres service isn't healthy (as it depends on healthiness of Postgres)
docker-compose ${ComposeRewriteFlags} down --remove-orphans
docker-compose ${ComposeRewriteFlags} build postgres
docker-compose ${ComposeRewriteFlags} up --detach postgres pgadmin

#! User defined during built time should exist at Postgres server, testing...
docker exec ethicapp-postgres /bin/bash -c \
    "psql postgresql://$DB_USER_NAME:$DB_USER_PASSWORD@localhost:5432/$DB_NAME -c '\conninfo'"

#*
#* Step (2): export bare database into host filesystem.
#*
mkdir -p ${newVolPath}
docker cp ethicapp-postgres:/var/lib/postgresql/${POSTGRES_VERSION}/main/ ${newVolPath}
mv ${newVolPath}/main/* ${newVolPath}
rm -R -v ${newVolPath}/main/

#*
#* Step (3): restart Postgres with mounted volume into previously exported database.
#*
export HOST_DB_VOLUME_PATH=${newVolPath}

docker-compose down --remove-orphans

# Setting mounted volume path defined in this bash script
docker-compose build postgres
docker-compose up --detach postgres

echo "[OK] Postgres service up and running with data volume at ${HOST_DB_VOLUME_PATH}"

docker-compose logs -f postgres

#!/bin/bash -e
# --------------------------------------------------------------------------------------------------
# Initializes the shared volume for the Postgres database in the host filesystem. The directory in
# which the virtualized Postgres database will be mounted at is $HOST_DB_VOLUME_PATH, but can be
# overridden if given as an argument.
# --------------------------------------------------------------------------------------------------

source .env

TargetVolumePath=${1:-$HOST_DB_VOLUME_PATH}

set -u

if test -d ${TargetVolumePath}; then
    echo "[ERROR] Directory \"${TargetVolumePath}\" already exists. Have you already initialized \
the DB shared volume?" >&2
    exit 1
fi;

#*
#* Step (1): start Postgres without shared volume mount (i.e. with proper schema and dev data).
#*
export HOST_DB_VOLUME_PATH=

TempComposeFilePath=./.docker-compose.NO-DB-VOLUME.temp
ComposeRewriteFlags="--file ${TempComposeFilePath}"

# Manually rewriting compose file, as usual docker-compose overrides can't undo an existing
# property, see https://github.com/docker/compose/issues/3729
touch ${TempComposeFilePath} #* not needed
echo "# ----
# GENERATED FILE FROM $0
# ----" > ${TempComposeFilePath}
sed 's^- "${HOST_DB_VOLUME_PATH}:/var/lib/postgresql/${POSTGRES_VERSION}/main:rw"^[]^g' \
    ./docker-compose.yml >> ${TempComposeFilePath}

docker-compose ${ComposeRewriteFlags} config 1> /dev/null

# Here, we also start PgAdmin service, as a trick for ensuring the `up` command does not return
# until the Postgres service isn't healthy (as it depends on healthiness of Postgres)
docker-compose ${ComposeRewriteFlags} down --remove-orphans
docker-compose ${ComposeRewriteFlags} build postgres
docker-compose ${ComposeRewriteFlags} up --detach postgres pgadmin

# Checking target Postgres role and database exist
docker exec ethicapp-postgres /bin/bash -c \
    "psql postgresql://$DB_USER_NAME:$DB_USER_PASSWORD@localhost:5432/$DB_NAME -c '\conninfo'"

#*
#* Step (2): export database files directly into host.
#*
mkdir -p ${TargetVolumePath}
docker cp --quiet ethicapp-postgres:/var/lib/postgresql/${POSTGRES_VERSION}/main/ ${TargetVolumePath}
mv ${TargetVolumePath}/main/* ${TargetVolumePath}
rm -R -v ${TargetVolumePath}/main/

#*
#* Step (3): restart Postgres with mounted volume into previously exported database.
#*
export HOST_DB_VOLUME_PATH=${TargetVolumePath}

docker-compose down --remove-orphans

# Setting mounted volume path defined in this bash script
docker-compose build postgres
docker-compose up --detach postgres

rm ${TempComposeFilePath}
echo "[OK] Postgres service up and running with development data volume at ${HOST_DB_VOLUME_PATH}"

#!/bin/bash -exu
# --------------------------------------------------------------------------------------------------
# Executes a "dump" for the containerized EthicApp database server, into the host's /tmp directory.
# Note: the schema is not included in the dump (data only).
# --------------------------------------------------------------------------------------------------

source .env

rm -f /tmp/dump-$DB_NAME.tar

docker exec ethicapp-postgres /bin/bash -c "
    PGPASSWORD=$DB_USER_PASSWORD pg_dump \
        --no-password \
        --host=localhost \
        --port=5432 \
        --dbname=$DB_NAME \
        --username=$DB_USER_NAME \
        --no-owner \
        --format=tar \
        --file=/tmp/dump-$DB_NAME.tar
"

docker cp ethicapp-postgres:/tmp/dump-$DB_NAME.tar /tmp/dump-host-$DB_NAME.tar

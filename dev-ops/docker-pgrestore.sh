#!/bin/bash -exu
# --------------------------------------------------------------------------------------------------
# Consumes an existing "dump" into the containerized EthicApp database.
# --------------------------------------------------------------------------------------------------

source .env

docker cp /tmp/dump-$DB_NAME.tar ethicapp-postgres:/tmp/dump-$DB_NAME.tar

docker exec ethicapp-postgres /bin/bash -c "
    PGPASSWORD=$DB_USER_PASSWORD pg_restore \
        --no-password \
        --host=localhost \
        --port=5432 \
        --dbname=$DB_NAME \
        --username=$DB_USER_NAME \
        /tmp/dump-$DB_NAME.tar
"

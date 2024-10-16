#!/bin/bash -exu
# --------------------------------------------------------------------------------------------------
# Executes a "dump" for the containerized EthicApp database server, into the host's /tmp directory.
# --------------------------------------------------------------------------------------------------

source .env

DUMP_FILE="/tmp/dump-$DB_NAME.tar.gz"
CONTAINER_NAME=$DB_CONTAINER_NAME

# Check whether the container is running
if ! docker ps --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
    echo "Container $CONTAINER_NAME is not running."
    exit 1
fi

# Eliminate any previous dump that was generated
if [ -f "$DUMP_FILE" ]; then
    echo "Deleted previous dump: $DUMP_FILE"
    rm -f "$DUMP_FILE"
fi

docker exec $CONTAINER_NAME /bin/bash -c "
    PGPASSWORD=$DB_PASSWORD pg_dump \
        --no-password \
        --host=localhost \
        --port=5432 \
        --dbname=$DB_NAME \
        --username=$DB_USERNAME \
        --no-owner \
        --format=tar \
        --file=/tmp/dump-$DB_NAME.tar && \
    gzip /tmp/dump-$DB_NAME.tar
"

docker cp $CONTAINER_NAME:/tmp/dump-$DB_NAME.tar.gz $DUMP_FILE

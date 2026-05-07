#!/bin/bash -exu
# --------------------------------------------------------------------------------------------------
# Restores a "dump" for the containerized EthicApp database server from the host's /tmp directory.
# --------------------------------------------------------------------------------------------------

source .env

DUMP_FILE="/tmp/dump-$DB_NAME.tar.gz"
UNCOMPRESSED_DUMP_FILE="/tmp/dump-$DB_NAME.tar"
CONTAINER_NAME=$DB_CONTAINER_NAME

# Check whether the database container is running
if ! docker ps --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
    echo "Container $CONTAINER_NAME is not running."
    exit 1
fi

# Check whether the dump file exists
if [ ! -f "$DUMP_FILE" ]; then
    echo "File $DUMP_FILE does not exist."
    exit 1
fi

# Function to ask for user confirmation
confirm_action() {
    read -r -p "$1 [y/N]: " response
    case "$response" in
        [yY][eE][sS]|[yY])
            true
            ;;
        *)
            false
            ;;
    esac
}

# Check if the database exists
if docker exec $CONTAINER_NAME psql -U "$DB_USERNAME" -d postgres -c "\l" | grep -qw "$DB_NAME"; then
    echo "The database $DB_NAME already exists."
    if confirm_action "Do you want to drop the existing database $DB_NAME?"; then
        # Drop the database
        docker exec $CONTAINER_NAME psql -U "$DB_USERNAME" -d postgres -c "DROP DATABASE $DB_NAME;"
        echo "Database $DB_NAME dropped."
    else
        echo "Operation cancelled by the user."
        exit 0
    fi
fi

# Create the database
docker exec $CONTAINER_NAME psql -U "$DB_USERNAME" -d postgres -c "CREATE DATABASE $DB_NAME;"
echo "Database $DB_NAME created."

# Inflate the dump file
echo "Inflating dump file $DUMP_FILE..."
gzip -dk "$DUMP_FILE"

# Copy the dump file to the container
docker cp $UNCOMPRESSED_DUMP_FILE $CONTAINER_NAME:/tmp/dump-$DB_NAME.tar

# Restore the dump within the container
docker exec $CONTAINER_NAME /bin/bash -c "
    PGPASSWORD=$DB_PASSWORD pg_restore \
        --no-password \
        --host=localhost \
        --port=5432 \
        --dbname=$DB_NAME \
        --username=$DB_USERNAME \
        --no-owner \
        /tmp/dump-$DB_NAME.tar
"

# Remove the uncompressed dump file
rm -f "$UNCOMPRESSED_DUMP_FILE"

echo "Database restore operation complete."

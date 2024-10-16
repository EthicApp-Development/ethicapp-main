#!/bin/bash -exu
# --------------------------------------------------------------------------------------------------
# Quick script for connecting to an interactive PostgreSQL console directly to the dockerized
# database.
# --------------------------------------------------------------------------------------------------

source .env

docker exec -it ethicapp-postgres /bin/bash -c \
    "psql postgresql://$DB_USERNAME:$DB_PASSWORD@localhost:5432/$DB_NAME"

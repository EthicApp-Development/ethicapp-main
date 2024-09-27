#!/bin/bash -exu
# --------------------------------------------------------------------------------------------------
# Script for initializing database (schema and development basic data). Intended to be ran at the
# database's Dockerfile (at build time).
# --------------------------------------------------------------------------------------------------
DB_CONNECTION_URI="postgresql://$DB_USER_NAME:$DB_USER_PASSWORD@localhost:5432/$DB_NAME"

/etc/init.d/postgresql start

# Replacing ENV variables at the SQL script
mv ./create-db.sql /tmp/create-db.sql
envsubst '${DB_USER_NAME} ${DB_USER_PASSWORD} ${DB_NAME}' < /tmp/create-db.sql > ./create-db.sql

# Creating development and test databases
su postgres -c "psql --set ON_ERROR_STOP=1 --file ./create-db.sql"

# Creating schema for development database
for sqlFile in ./schema/*.sql; do
    psql ${DB_CONNECTION_URI} --set ON_ERROR_STOP=1 --file ${sqlFile}
done

# Populating development database with basic data
for sqlFile in ./seeds/development/*.sql; do
    psql ${DB_CONNECTION_URI} --set ON_ERROR_STOP=1 --file ${sqlFile}
done

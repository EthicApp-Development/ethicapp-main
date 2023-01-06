#!/bin/bash -exu

# ---
# /etc/init.d/postgresql start

# # Creating root user, just for avoiding postgres logging complaints during healthchecks
# su postgres -c "psql --command=\"\
#     CREATE ROLE root WITH \
#     NOSUPERUSER \
#     LOGIN; \
# \"" \
# && su postgres -c "psql --command=\"\
#     CREATE DATABASE root WITH \
#     OWNER root; \
# \""
# # Other setup
# su postgres -c "psql --command=\"
#     CREATE ROLE app WITH
#     NOSUPERUSER
#     LOGIN
#     PASSWORD 'app2020'
#     CREATEDB
#     NOCREATEROLE;
# \""
# su postgres -c "psql --command=\"
#     CREATE DATABASE doccollab WITH
#     OWNER app
#     ENCODING 'UTF-8';
# \""
# su postgres -c "psql postgresql://app:app2020@localhost:5432/doccollab \
#     --file=/code/ethicapp-postgres-2022-12-06.sql \
#     --quiet"
# PGPASSWORD=app2020 su postgres -c "pg_restore \
#     --host=localhost \
#     --port=5432 \
#     --username=app \
#     --no-password \
#     --no-owher \
#     --schema-only \
#     /code/ethicapp-postgres-2022-12-06.sql"

# /etc/init.d/postgresql stop
# ---

# Handling permissions due Postgres security constraints
chown -R postgres:postgres ${PGDATA}
chmod -R 0700 ${PGDATA}

su postgres -c "/usr/lib/postgresql/${POSTGRES_VERSION}/bin/postgres \
    -d ${POSTGRES_LOG_LEVEL} \
    -p ${PGPORT} \
    -h 0.0.0.0 \
    -D ${PGDATA} \
    -c config_file=/etc/postgresql/${POSTGRES_VERSION}/main/postgresql.conf"

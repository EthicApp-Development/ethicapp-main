#!/bin/bash -exu

# Handling permissions due Postgres security constraints
chown -R postgres:postgres ${PGDATA}
chmod -R 0700 ${PGDATA}

su postgres -c "/usr/lib/postgresql/${POSTGRES_VERSION}/bin/postgres \
    -d ${POSTGRES_LOG_LEVEL} \
    -p ${PGPORT} \
    -h 0.0.0.0 \
    -D ${PGDATA} \
    -c config_file=/etc/postgresql/${POSTGRES_VERSION}/main/postgresql.conf"

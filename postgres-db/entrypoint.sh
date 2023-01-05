#!/bin/bash -exu

# Handling permissions due Docker volume
chown -R postgres:postgres ${PGDATA}
chmod -R 700 ${PGDATA}

cp -fr /tmp/data/* /var/lib/postgresql/data

# su postgres -c "/usr/lib/postgresql/${POSTGRES_VERSION_MAJOR}/bin/postgres \
#     -d ${POSTGRES_LOG_LEVEL} \
#     -p ${POSTGRES_PORT} \
#     -D ${PGDATA} \
#     -h 0.0.0.0 \
#     -c config_file=/etc/postgresql/${POSTGRES_VERSION_MAJOR}/main/postgresql.conf"

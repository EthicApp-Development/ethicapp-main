ARG PGADMIN_VERSION
FROM dpage/pgadmin4:${PGADMIN_VERSION}

# Installing `envsubst`
USER root
RUN apk update && apk add gettext

ARG POSTGRES_CONN_PORT
ARG POSTGRES_CONN_USER

# Configuring server connections
COPY servers.json /tmp/servers.json
RUN envsubst '${POSTGRES_CONN_PORT} ${POSTGRES_CONN_USER}' < /tmp/servers.json > ./servers.json
USER pgadmin

ARG PGADMIN_VERSION
FROM dpage/pgadmin4:${PGADMIN_VERSION}

# Installing `envsubst`
USER root
RUN apk update && apk add gettext

COPY servers.json /tmp/servers.json

# Configuring server connections (parsing ENV files at config JSON file)
ARG POSTGRES_CONN_PORT
ARG POSTGRES_CONN_USER
RUN envsubst '${POSTGRES_CONN_PORT} ${POSTGRES_CONN_USER}' < /tmp/servers.json > ./servers.json

USER pgadmin

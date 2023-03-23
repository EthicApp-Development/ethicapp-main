ARG UBUNTU_VERSION
FROM ubuntu:${UBUNTU_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /tmp

# Installing dependencies, basic debugging utilities (including envsubst) and spanish language pack
RUN apt-get update --quiet && apt-get install --quiet -y \
        wget \
        man  \
        nano \
        gnupg \
        ca-certificates \
        language-pack-es \
        lsb-core \
        gettext-base

ARG POSTGRES_VERSION

# Installing PostgreSQL server
RUN echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - \
    && apt-get update --quiet && apt-get install --quiet -y \
        postgresql-${POSTGRES_VERSION}

# Allowing all external connections
RUN echo "\
host    all         all     0.0.0.0/0    md5 \n\
host    all         all     ::/0         md5 \n\
" >> /etc/postgresql/${POSTGRES_VERSION}/main/pg_hba.conf

RUN adduser --disabled-password --gecos "" healthcheckuser

WORKDIR /ethicapp-db

COPY init-db.sh .
COPY create-db.sql .
COPY schema/ schema/
COPY seeds/ seeds/

ARG DB_USER_NAME
ARG DB_USER_PASSWORD
ARG DB_NAME

RUN chmod +x init-db.sh \
    && ./init-db.sh

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
ENV POSTGRES_VERSION=${POSTGRES_VERSION}

CMD [ "/ethicapp-db/entrypoint.sh" ]

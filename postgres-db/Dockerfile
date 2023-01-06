# --------------------------------------------------------------------------------------------------
# Temporarily based on blank Ubuntu for easy setup and debugging.
# --------------------------------------------------------------------------------------------------

ARG UBUNTU_VERSION
FROM ubuntu:${UBUNTU_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /tmp

# Installing basic debugging utilities and spanish language pack
RUN apt-get update --quiet && apt-get install --quiet -y \
        wget \
        man  \
        nano \
        gnupg \
        ca-certificates \
        language-pack-es \
        lsb-core

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

WORKDIR /code
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

ENV POSTGRES_VERSION=${POSTGRES_VERSION}

CMD [ "/code/entrypoint.sh" ]

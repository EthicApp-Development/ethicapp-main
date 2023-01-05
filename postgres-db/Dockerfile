ARG POSTGRES_VERSION_MAJOR
ARG POSTGRES_VERSION_MINOR
FROM postgres:${POSTGRES_VERSION_MAJOR}.${POSTGRES_VERSION_MINOR}

# Installing basic debugging utilities
RUN apt-get update --quiet && apt-get install -y \
    wget \
    man \
    nano \
    gnupg

COPY setup_db.sql .
COPY entrypoint.sh .
RUN chmod +x ./entrypoint.sh

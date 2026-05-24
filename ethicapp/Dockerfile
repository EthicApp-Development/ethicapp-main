FROM node:24 AS backend-test

WORKDIR /app/backend
COPY ethicapp/backend/package*.json ./
RUN npm ci
COPY ethicapp/backend ./
RUN npm test && touch /tmp/backend-tests-passed

FROM node:24

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Runtime dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends imagemagick poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend-test /tmp/backend-tests-passed /tmp/backend-tests-passed
RUN rm /tmp/backend-tests-passed

# Application files
COPY ethicapp/backend /app/backend
COPY ethicapp/common /app/common
COPY ethicapp/frontend /app/frontend
COPY ethicapp/scripts /app/scripts
COPY database/seeds /database/seeds

# Entrypoint script
COPY ethicapp/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh /app/scripts/*.sh

RUN cd /app/frontend \
    && npm ci \
    && /app/scripts/build-frontend-assets.sh \
    && rm -rf /app/frontend/node_modules

# Persistent upload directory
RUN mkdir -p /app/backend/uploads \
    && chmod 777 /app/backend/uploads

ENTRYPOINT ["/app/entrypoint.sh"]

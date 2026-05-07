FROM node:24

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Runtime dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends imagemagick \
    && rm -rf /var/lib/apt/lists/*

# Application files
COPY backend /app/backend
COPY common /app/common
COPY frontend /app/frontend
COPY scripts /app/scripts

# Entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh /app/scripts/*.sh

RUN cd /app/frontend \
    && npm ci \
    && /app/scripts/build-frontend-assets.sh \
    && rm -rf /app/frontend/node_modules

# Crear directorios persistentes
RUN mkdir -p /app/backend/uploads /app/backend/sessions \
    && chmod 777 /app/backend/uploads \
    && chmod 755 /app/backend/sessions

ENTRYPOINT ["/app/entrypoint.sh"]

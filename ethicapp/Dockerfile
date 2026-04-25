FROM node:24

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Runtime dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends imagemagick \
    && rm -rf /var/lib/apt/lists/*

# Application files
COPY backend /app/backend
COPY frontend /app/frontend

# Entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Crear directorios persistentes
RUN mkdir -p /app/uploads /app/sessions \
    && chmod 777 /app/uploads \
    && chmod 755 /app/sessions

ENTRYPOINT ["/app/entrypoint.sh"]

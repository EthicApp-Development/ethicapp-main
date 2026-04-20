ARG ETHICAPP_NODE_VERSION
FROM node:${ETHICAPP_NODE_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

# Copiar manifests
COPY package*.json ./

# Set the working directory
WORKDIR /app

# Application files
COPY backend ./backend
COPY frontend ./frontend

# Entrypoint script
COPY entrypoint.sh ./backend/entrypoint.sh

# Crear directorios persistentes
RUN mkdir -p /app/uploads /app/sessions \
    && chmod 777 /app/uploads \
    && chmod 755 /app/sessions

# Define the entrypoint
ENTRYPOINT ["./backend/entrypoint.sh"]
#CMD ["node", "backend/ethicapp"]

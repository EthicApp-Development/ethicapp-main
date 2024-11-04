ARG ETHICAPP_NODE_VERSION
FROM node:${ETHICAPP_NODE_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

# Application files
COPY backend /home/app/backend
COPY frontend /home/app/frontend
#COPY package.json /home/app
#COPY nodemon.json /home/app
#COPY build_hash.json /home/app

# Entrypoint script
COPY backend/entrypoint.development.sh /usr/local/bin/entrypoint.development.sh
RUN chmod +x /usr/local/bin/entrypoint.development.sh

# Set the working directory
WORKDIR /home/app

# Define the entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.development.sh"]

ARG NODE_VERSION
FROM node:${NODE_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

# Application files
COPY backend /home/app/backend
COPY frontend /home/app/frontend
COPY app.js /home/app
COPY package.json /home/app

# Entrypoint script
COPY entrypoint.development.sh /usr/local/bin/entrypoint.development.sh
RUN chmod +x /usr/local/bin/entrypoint.development.sh

# Set the working directory
WORKDIR /home/app

# Define the entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.development.sh"]

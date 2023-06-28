ARG NODE_VERSION
FROM node:${NODE_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

COPY backend /home/app/backend
COPY frontend /home/app/frontend
COPY app.js /home/app
COPY package.json /home/app

WORKDIR /home/app

#Comment the CMD lines whenever you wish to renew the DockerHub image.
CMD set -ux \
    && export JWT_SECRET=$(cat /run/secrets/jwt_token) \
    && npm install \
    && PORT=${NODE_PORT} npm start

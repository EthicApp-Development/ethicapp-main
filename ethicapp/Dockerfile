ARG NODE_VERSION
FROM node:${NODE_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

COPY ./ /home/app

WORKDIR /home/app

CMD set -ux \
    && export JWT_SECRET=$(cat /run/secrets/jwt_token) \
    && cp /run/secrets/keys-n-secrets.js /home/app/backend/config/ \
    && npm install \
    && PORT=${NODE_PORT} npm start

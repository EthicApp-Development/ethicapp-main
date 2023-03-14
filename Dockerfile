ARG NODE_VERSION
FROM node:${NODE_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /home/app

CMD set -ux \
    && test -f /run/secrets/jwt_token \
    && export JWT_SECRET=$(cat /run/secrets/jwt_token) \
    && npm install \
    && PORT=${NODE_PORT} npm start

ARG NODE_VERSION
FROM node:${NODE_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /home/app

CMD test -f /run/secrets/jwt_token \
    && export JWT_SECRET=$(cat /run/secrets/jwt_token) \
    && npm install \
    && npm start

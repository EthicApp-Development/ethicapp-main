FROM ethicapp/stable-2:latest

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /home/app

CMD set -ux \
    && export JWT_SECRET=$(cat /run/secrets/jwt_token) \
    && cp /run/secrets/keys-n-secrets.js /home/app/backend/config/ \
    && npm install \
    && PORT=${NODE_PORT} npm start

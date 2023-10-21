FROM ethicapp/stable-2:latest

ARG DEBIAN_FRONTEND=noninteractive

WORKDIR /home/app

COPY frontend/assets/js/assets-bundle.js /home/app/frontend/assets/js/
COPY frontend/assets/css/assets-bundle.css /home/app/frontend/assets/css/
COPY frontend/assets/css/assets-bundle.css.map /home/app/frontend/assets/css/

CMD set -ux \
    && export JWT_SECRET=$(cat /run/secrets/jwt_token) \
    && cp /run/secrets/keys-n-secrets.js /home/app/backend/config/ \
    && npm install \
    && PORT=${NODE_PORT} npm start

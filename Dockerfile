ARG NODE_VERSION
FROM node:${NODE_VERSION}

RUN mkdir -p /home/app

WORKDIR /home/app

CMD npm install && npm start

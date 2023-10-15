FROM node:14-alpine

WORKDIR /home/app

COPY package*.json ./

RUN npm install

ARG REACT_APP_API_PORT

ENV REACT_APP_API_PORT $REACT_APP_API_PORT

COPY . .

RUN npm run build

CMD ["npm", "start"]

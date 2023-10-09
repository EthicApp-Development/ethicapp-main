FROM node:14-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

ARG REACT_APP_API_PORT

ENV REACT_APP_API_PORT $REACT_APP_API_PORT

COPY . .

RUN npm run build

RUN npm install -g serve

EXPOSE 3000

CMD ["serve", "-s", "build", "-l", "3000"]

FROM node:12.22.9-buster
RUN mkdir -p /home/app
WORKDIR /home/app
#COPY ["package.json", "package-lock.json*", "./"]
#RUN npm install
#COPY . .
CMD npm install && npm start

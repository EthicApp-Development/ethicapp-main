FROM nginx:alpine

COPY nginx.conf /etc/nginx/templates/nginx.conf.template

ARG DEBIAN_FRONTEND=noninteractive

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
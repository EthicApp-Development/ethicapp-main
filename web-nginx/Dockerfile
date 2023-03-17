ARG NGINX_VERSION
FROM nginx:${NGINX_VERSION}

ARG DEBIAN_FRONTEND=noninteractive

# Installing envsubst
RUN apt-get update --quiet && apt-get install -y gettext-base

COPY nginx.conf /tmp/nginx.conf

ARG NODE_PORT
RUN envsubst '${NODE_PORT}' < /tmp/nginx.conf > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD [ "nginx", "-c", "/etc/nginx/conf.d/default.conf", "-g", "daemon off;" ]

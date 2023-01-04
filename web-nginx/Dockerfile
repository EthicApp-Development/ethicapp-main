ARG NGINX_VERSION
FROM nginx:${NGINX_VERSION}

# Installing envsubst
RUN apt-get update --quiet && apt-get install -y gettext-base

COPY nginx.conf /tmp/nginx.conf

ARG WEB_APP_PORT
RUN envsubst '${WEB_APP_PORT}' < /tmp/nginx.conf > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD [ "nginx", "-c", "/etc/nginx/conf.d/default.conf", "-g", "daemon off;" ]

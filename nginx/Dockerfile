FROM nginx:1.28-alpine

COPY conf.d/default.conf /etc/nginx/conf.d/default.conf
COPY conf.d/maintenance.conf.template /etc/nginx/maintenance.conf.template
COPY docker-entrypoint.d /docker-entrypoint.d
COPY static /usr/share/nginx/html/static
RUN chmod +x /docker-entrypoint.d/*.sh

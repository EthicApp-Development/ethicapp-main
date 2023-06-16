FROM nginx:alpine

COPY nginx.conf /etc/nginx/templates/nginx.conf.template

EXPOSE ${NGINX_PORT}

CMD ["nginx", "-g", "daemon off;"]
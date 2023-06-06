FROM nginx:alpine

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE ${NGINX_PORT}

CMD ["nginx", "-g", "daemon off;"]
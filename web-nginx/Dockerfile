ARG NGINX_VERSION
FROM nginx:${NGINX_VERSION}

COPY ./index.html /usr/share/nginx/html/index.html

#!
COPY nginx.conf /tmp/nginx.conf
ENV bar=23
RUN envsubst < /tmp/nginx.conf > /etc/nginx/nginx.conf

EXPOSE 80

CMD echo "hello" && cat /etc/nginx/nginx.conf
#ENTRYPOINT [ "/bin/bash" ]

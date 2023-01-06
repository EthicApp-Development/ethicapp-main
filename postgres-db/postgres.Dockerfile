# Currently unused
#TODO: use this image as base instead of bare Ubuntu

FROM postgres:10.19-bullseye

WORKDIR /code

COPY entrypoint.sh .
RUN chmod +x /code/entrypoint.sh

CMD [ "/code/entrypoint.sh" ]

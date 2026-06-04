FROM flyway/flyway:11-alpine

COPY migrations /flyway/migrations
COPY docker-entrypoint.sh /usr/local/bin/ethicapp-db-migrations-entrypoint

ENV FLYWAY_LOCATIONS=filesystem:/flyway/migrations

RUN chmod +x /usr/local/bin/ethicapp-db-migrations-entrypoint

ENTRYPOINT ["ethicapp-db-migrations-entrypoint"]
CMD ["migrate"]

-- Database: doccollab

-- DROP DATABASE IF EXISTS doccollab;

CREATE DATABASE doccollabtest
    WITH
    OWNER = postgres
    ENCODING = 'UTF8'
    --LC_COLLATE = 'en_US.utf8'
    --LC_CTYPE = 'en_US.utf8'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1
    IS_TEMPLATE = False;

GRANT TEMPORARY, CONNECT ON DATABASE doccollabtest TO PUBLIC;

GRANT ALL ON DATABASE doccollabtest TO app;

GRANT ALL ON DATABASE doccollabtest TO postgres;

CREATE TABLE IF NOT EXISTS test(
    id serial,
    sesid integer,
    PRIMARY KEY(id)
);
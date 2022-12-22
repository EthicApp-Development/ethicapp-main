-- Database: :db_name
-- DROP DATABASE IF EXISTS :db_name

CREATE DATABASE :db_name
    WITH
    OWNER = :pg_user
    ENCODING = 'UTF8'
    --LC_COLLATE = 'en_US.utf8'
    --LC_CTYPE = 'en_US.utf8'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1
    IS_TEMPLATE = False;

GRANT TEMPORARY, CONNECT ON DATABASE :db_name TO PUBLIC;

GRANT ALL ON DATABASE :db_name TO :pg_user;

GRANT ALL ON DATABASE :db_name TO postgres;

CREATE ROLE :pg_user WITH PASSWORD :pg_password;

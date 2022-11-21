/* DROP TABLE institution; */
CREATE TABLE IF NOT EXISTS institution(
    id serial,
    userid integer REFERENCES users(id),
    institution_name text,
    num_students int,
    country text,
    position text,
    PRIMARY KEY(id)
);


ALTER TABLE institution RENAME COLUMN numestudents TO num_students;

ALTER TABLE institution RENAME COLUMN institutionname TO institution_name;

ALTER TABLE institution DROP COLUMN maildomains;


CREATE TABLE IF NOT EXISTS mail_domain(
    id serial,
    institutionid integer REFERENCES institution(id),
    domain_name text,
    PRIMARY KEY(id)
);

ALTER TABLE mail_domain ADD CONSTRAINT domain_name UNIQUE(domain_name);

/*
GRANT SELECT ON TABLE institution TO app;
GRANT ALL PRIVILEGES ON TABLE institution TO app;
GRANT ALL ON TABLE institution TO app;
GRANT USAGE, SELECT ON SEQUENCE institution_id_seq TO app;


GRANT SELECT ON TABLE mail_domain TO app;
GRANT ALL PRIVILEGES ON TABLE mail_domain TO app;
GRANT ALL ON TABLE mail_domain TO app;
GRANT USAGE, SELECT ON SEQUENCE mail_domain_id_seq TO app;

*/

ALTER TABLE users ALTER COLUMN rut DROP NOT NULL;

CREATE TABLE IF NOT EXISTS temporary_users(
    id serial,
    name text NOT NULL,
    rut text NULL,
    pass text NOT NULL,
    mail text NOT NULL,
    sex char(1),
    role char(1),
    PRIMARY KEY(id)
);


CREATE TABLE IF NOT EXISTS temporary_institution(
    id serial,
    userid integer REFERENCES temporary_users(id),
    institution_name text,
    num_students int,
    country text,
    mail_domains text,
    position text,
    acepted boolean NOT NULL,
    PRIMARY KEY(id)
);

ALTER TABLE temporary_users ADD COLUMN token text NULL;

/*
GRANT SELECT ON temporary_users TO app;
GRANT ALL PRIVILEGES ON temporary_users TO app;
GRANT ALL ON TABLE temporary_users TO app;
GRANT USAGE, SELECT ON SEQUENCE temporary_users_id_seq TO app;

GRANT SELECT ON temporary_institution TO app;
GRANT ALL PRIVILEGES ON temporary_institution TO app;
GRANT ALL ON TABLE temporary_institution TO app;
GRANT USAGE, SELECT ON SEQUENCE temporary_institution_id_seq TO app;


GRANT ALL PRIVILEGES ON DATABASE doccollab TO app;
*/

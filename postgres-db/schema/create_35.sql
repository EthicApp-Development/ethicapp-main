CREATE TABLE IF NOT EXISTS institution(
    id serial,
    userid integer REFERENCES users(id),
    institution_name text,
    num_students int,
    country text,
    position text,
    PRIMARY KEY(id)
);

CREATE TABLE IF NOT EXISTS mail_domain(
    id serial,
    institutionid integer REFERENCES institution(id),
    domain_name text UNIQUE, -- ALTER TABLE mail_domain ADD CONSTRAINT domain_name UNIQUE(domain_name);
    PRIMARY KEY(id)
);

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

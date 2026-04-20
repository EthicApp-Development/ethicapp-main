CREATE TABLE IF NOT EXISTS institution (
    id serial,
    institution_name text,
    institution_url text,
    ethicapp_url text,
    physical_address text,
    institution_logo text,
    institution_it_email text,
    institution_educational_email text,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS temporary_users (
    id serial,
    name text NOT NULL,
    rut text NULL,
    pass text NOT NULL,
    mail text NOT NULL,
    sex char(1),
    role char(1),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS temporary_institution (
    id serial,
    userid integer REFERENCES temporary_users (id),
    institution_name text,
    num_students int,
    country text,
    mail_domains text,
    position text,
    acepted boolean NOT NULL,
    PRIMARY KEY (id)
);

ALTER TABLE temporary_users ADD COLUMN token text NULL;

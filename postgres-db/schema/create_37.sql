CREATE TABLE IF NOT EXISTS report_activity (
    creation_date DATE,
    professor INT,
    count INT,
    PRIMARY KEY (creation_date, professor)
);

CREATE TABLE IF NOT EXISTS report_create_account (
    creation_date DATE,
    count INT,
    PRIMARY KEY (creation_date)
);

CREATE TABLE IF NOT EXISTS report_login (
    login_date DATE,
    count INT,
    PRIMARY KEY (login_date)
);

CREATE TABLE IF NOT EXISTS report_type (
    id serial,
    report_type text,
    report_description text,
    PRIMARY KEY (id)
);

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
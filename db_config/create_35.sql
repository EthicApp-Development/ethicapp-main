/* DROP TABLE institution; */
create table if not exists institution(
    id serial,
    userid integer references users(id),
    institution_name text,
    num_students int,
    country text,
    position text,
    primary key(id)
);


ALTER TABLE institution RENAME COLUMN numEstudents TO num_students;

ALTER TABLE institution 
RENAME COLUMN institutionName TO institution_name;

ALTER TABLE institution.
DROP COLUMN mailDomains;



create table if not exists mail_domain(
    id serial,
    institutionid integer references institution(id),
    domain_name text,
    primary key(id)
    
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

create table if not exists temporary_users(
    id serial,
    name text not null,
    rut text null,
    pass text not null,
    mail text not null,
    sex char(1),
    role char(1),
    primary key(id)
);



create table if not exists temporary_institution(
    id serial,
    userid integer references temporary_users(id),
    institution_name text,
    num_students int,
    country text,
    mail_domains text,
    position text,
    acepted boolean not null,
    primary key(id)
);

ALTER TABLE temporary_users ADD COLUMN token text null;

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

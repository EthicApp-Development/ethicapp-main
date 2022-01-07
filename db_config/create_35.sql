create table if not exists institucion(
    id serial,
    userid integer references users(id),
    institutionName text,
    numEstudents int,
    country text,
    mailDomains text,
    position text
);

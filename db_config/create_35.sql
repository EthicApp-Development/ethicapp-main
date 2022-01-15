create table if not exists institution(
    id serial,
    userid integer references users(id),
    institutionName text,
    numEstudents int,
    country text,
    mailDomains text,
    position text
);

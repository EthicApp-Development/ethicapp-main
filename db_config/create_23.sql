create table pass_reset(
    id serial,
    mail varchar(32) not null,
    token varchar(64) not null,
    ctime timestamp,
    primary key(id)
);
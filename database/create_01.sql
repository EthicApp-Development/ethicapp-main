-- 1. Postgres script for create database

create table if not exists users (
    id serial,
    name text not null,
    rut text not null,
    pass text not null,
    mail text not null constraint users_mail_unique unique,
    sex char(1),
    role char(1),
    primary key(id)
);


create table if not exists sessions (
    id serial,
    name text not null,
    descr text,
    status integer,
    time timestamp with time zone,
    creator integer,
    code char(6),
    type char(1),
    primary key (id),
    foreign key(creator) references users(id)
);


create table if not exists sesusers (
    sesid integer,
    uid integer,
    foreign key(sesid) references sessions(id),
    foreign key(uid) references users(id)
);


create table if not exists questions (
    id serial,
    content text,
    options text,
    answer integer,
    comment text,
    other text,
    sesid integer,
    primary key(id),
    foreign key(sesid) references sessions(id)
);

create table if not exists teams (
    id serial,
    sesid integer,
    primary key(id),
    foreign key(sesid) references sessions(id)
);

CREATE TABLE IF NOT EXISTS teamusers (
    tmid integer,
    uid integer,
    anon_mask CHAR(1),
    FOREIGN KEY (tmid) REFERENCES teams (id),
    FOREIGN KEY (uid) REFERENCES users (id)
);

CREATE INDEX idx_teamusers_tmid ON teamusers(tmid);
CREATE INDEX idx_teamusers_uid ON teamusers(uid);

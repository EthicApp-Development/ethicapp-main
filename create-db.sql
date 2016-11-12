-- Postgres script for create database

create table if not exists users (
    id serial,
    name text not null,
    rut text not null,
    pass text not null,
    mail text not null,
    sex char(1),
    role char(1),
    primary key(id)
);


create table if not exists sessions (
    id serial,
    name text not null,
    descr text,
    time timestamp with time zone,
    creator integer,
    code char(6),
    primary key (id),
    foreign key(creator) references users(id)
);


create table if not exists sesusers (
    sesid integer,
    uid integer,
    foreign key(sesid) references sessions(id),
    foreign key(uid) references users(id)
);



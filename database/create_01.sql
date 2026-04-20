-- 1. Postgres script for create database

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


create table if not exists documents (
    id serial,
    title text not null,
    path text not null,
    sesid integer,
    uploader integer,
    primary key(id),
    foreign key(sesid) references sessions(id),
    foreign key(uploader) references users(id)
);


create table if not exists ideas (
    id serial,
    content text,
    descr text,
    serial varchar(255),
    iteration integer default 1,
    uid integer,
    docid integer,
    primary key(id),
    foreign key(uid) references users(id),
    foreign key(docid) references documents(id)
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

create table if not exists selection (
    answer integer,
    uid integer,
    iteration integer default 1,
    comment text,
    qid integer,
    primary key(uid,qid),
    foreign key(uid) references users(id),
    foreign key(qid) references questions(id)
);

create table if not exists teams (
    id serial,
    sesid integer,
    primary key(id),
    foreign key(sesid) references sessions(id)
);

create table if not exists teamusers (
    tmid integer,
    uid integer,
    foreign key(tmid) references teams(id),
    foreign key(uid) references users(id)
);
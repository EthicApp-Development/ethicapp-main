-- 2. Postgres script for create database

create table if not exists rubricas (
    id serial,
    sesid integer,
    primary key(id),
    foreign key(sesid) references sessions(id)
);

create table if not exists reports (
    id serial,
    content text,
    example boolean default false,
    rid integer,
    uid integer,
    primary key(id),
    foreign key(rid) references rubricas(id),
    foreign key(uid) references users(id)
);

create table if not exists criteria (
    id serial,
    name text not null,
    pond integer not null,
    inicio text,
    proceso text,
    competente text,
    avanzado text,
    rid integer,
    primary key(id),
    foreign key(rid) references rubricas(id)
);

create table if not exists criteria_selection (
    id serial,
    selection integer,
    cid integer,
    uid integer,
    repid integer,
    primary key(id),
    foreign key(cid) references criteria(id),
    foreign key(uid) references users(id),
    foreign key(repid) references reports(id)
);

create table report_pair (
    id serial,
    uid integer,
    sesid integer,
    repid integer,
    primary key(id),
    foreign key(uid) references users(id),
    foreign key(sesid) references sessions(id),
    foreign key(repid) references reports(id)
);

create type tipo_aprendizaje as enum('Reflexivo','Activo','Teorico','Pragmatico');
alter table users add column aprendizaje tipo_aprendizaje;

alter table teams add column leader integer;
alter table teams add constraint fk_leader foreign key(leader) references users(id);
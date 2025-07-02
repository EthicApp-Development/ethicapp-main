create table if not exists stages(
    id          serial,
    number      integer not null,
    type        varchar(15) not null,
    anon        boolean default false,
    chat        boolean default false,
    prev_ans    varchar(255),
    sesid       integer references sessions(id),
    primary key(id)
);


create table if not exists actors(
    id      serial,
    name    varchar(255) not null,
    jorder  boolean not null,
    stageid integer references stages(id),
    primary key(id)
);


create table if not exists actor_selection(
    id              serial,
    description     text not null,
    orden           integer,
    actorid         integer references actors(id),
    uid             integer references users(id),
    stageid         integer references stages(id),
    primary key(id)
);

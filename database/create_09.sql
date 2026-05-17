create table if not exists differential(
    id      serial,
    title   text default '',
    tleft   text not null,
    tright  text not null,
    orden   integer not null,
    creator integer references users(id),
    sesid   integer references sessions(id),
    primary key(id)
);

create table if not exists differential_selection(
    id      serial,
    uid     integer references users(id),
    did     integer references differential(id),
    sel     integer not null,
    iteration   integer,
    comment text,
    stime   timestamp default now()
);

create table if not exists differential_chat(
    id      serial,
    uid     integer references users(id),
    did     integer references differential(id),
    content text,
    stime   timestamp default now()
);
create table if not exists chat(
    id          serial,
    sesid       integer references sessions(id),
    stageid     integer references stages(id),
    uid         integer references users(id),
    content     text,
    stime       timestamp default now(),
    parent_id   integer references chat(id),
    primary key(id)
);

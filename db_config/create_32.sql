create table if not exists jigsaw_role(
    id              serial,
    name            varchar(255) not null,
    description     text,
    sesid           integer references sessions(id),
    primary key(id)
);


create table if not exists jigsaw_users(
    stageid     integer references stages(id),
    userid      integer references users(id),
    roleid      integer references jigsaw_role(id)
);

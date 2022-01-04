create table if not exists designs (
    id serial,
    creator integer,
    design jsonb,
    foreign key(creator) references users(id)
);
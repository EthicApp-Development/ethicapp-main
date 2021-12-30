create table if not exists designs (
    id serial,
    creator integer,
    design json NOT NULL,
    foreign key(creator) references users(id)
);
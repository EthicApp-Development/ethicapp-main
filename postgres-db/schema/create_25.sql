CREATE TABLE IF NOT EXISTS stages(
    id serial,
    number integer NOT NULL,
    type varchar(15) NOT NULL,
    anon boolean DEFAULT false,
    chat boolean DEFAULT false,
    prev_ans varchar(255),
    sesid integer REFERENCES sessions(id),
    PRIMARY KEY(id)
);

CREATE TABLE IF NOT EXISTS actors(
    id serial,
    name varchar(255) NOT NULL,
    jorder boolean NOT NULL,
    stageid integer REFERENCES stages(id),
    PRIMARY KEY(id)
);

CREATE TABLE IF NOT EXISTS actor_selection(
    id serial,
    description text NOT NULL,
    orden integer,
    actorid integer REFERENCES actors(id),
    uid integer REFERENCES users(id),
    stageid integer REFERENCES stages(id),
    PRIMARY KEY(id)
);

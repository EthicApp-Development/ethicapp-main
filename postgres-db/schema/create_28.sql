CREATE TABLE IF NOT EXISTS chat (
    id serial,
    sesid integer REFERENCES sessions (id),
    stageid integer REFERENCES stages (id),
    uid integer REFERENCES users (id),
    content text,
    stime timestamp DEFAULT now(),
    parent_id integer REFERENCES chat (id),
    PRIMARY KEY (id)
);

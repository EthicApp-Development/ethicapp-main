CREATE TABLE IF NOT EXISTS differential(
    id serial,
    title text DEFAULT '',
    tleft text NOT NULL,
    tright text NOT NULL,
    orden integer NOT NULL,
    creator integer REFERENCES users(id),
    sesid integer REFERENCES sessions(id),
    PRIMARY KEY(id)
);

CREATE TABLE IF NOT EXISTS differential_selection(
    id serial,
    uid integer REFERENCES users(id),
    did integer REFERENCES differential(id),
    sel integer NOT NULL,
    iteration integer,
    comment text,
    stime timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS differential_chat(
    id serial,
    uid integer REFERENCES users(id),
    did integer REFERENCES differential(id),
    content text,
    stime timestamp DEFAULT now()
);

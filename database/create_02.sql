CREATE TABLE IF NOT EXISTS actors (
    id serial PRIMARY KEY,
    name varchar(255) NOT NULL,
    jorder boolean NOT NULL,
    phase_id integer REFERENCES phases(id),
    justified boolean DEFAULT true,
    word_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actor_selection (
    id serial PRIMARY KEY,
    description text NOT NULL,
    orden integer,
    actorid integer REFERENCES actors(id),
    uid integer REFERENCES users(id),
    phase_id integer REFERENCES phases(id),
    stime timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS differential (
    id serial PRIMARY KEY,
    title text DEFAULT '',
    tleft text NOT NULL,
    tright text NOT NULL,
    orden integer NOT NULL,
    creator integer REFERENCES users(id),
    session_id integer REFERENCES sessions(id),
    phase_id integer REFERENCES phases(id),
    justify boolean DEFAULT true,
    num integer DEFAULT 7,
    word_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS differential_selection (
    id serial,
    uid integer REFERENCES users(id),
    did integer REFERENCES differential(id),
    sel integer NOT NULL,
    iteration integer,
    comment text,
    stime timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS differential_chat (
    id serial PRIMARY KEY,
    uid integer REFERENCES users(id),
    did integer REFERENCES differential(id),
    content text,
    stime timestamp DEFAULT now(),
    parent_id integer REFERENCES differential_chat(id),
    group_id integer REFERENCES groups(id)
);

CREATE TABLE IF NOT EXISTS chat (
    id serial PRIMARY KEY,
    session_id integer REFERENCES sessions(id),
    phase_id integer REFERENCES phases(id),
    uid integer REFERENCES users(id),
    content text,
    stime timestamp DEFAULT now(),
    parent_id integer REFERENCES chat(id),
    group_id integer REFERENCES groups(id)
);

CREATE INDEX IF NOT EXISTS idx_differential_chat_group_id ON differential_chat(group_id);
CREATE INDEX IF NOT EXISTS idx_chat_group_id ON chat(group_id);

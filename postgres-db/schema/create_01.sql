CREATE TABLE IF NOT EXISTS users (
    id serial,
    name text NOT NULL,
    rut text NOT NULL,
    pass text NOT NULL,
    mail text NOT NULL,
    sex char(1),
    role char(1),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id serial,
    name text NOT NULL,
    descr text,
    status integer,
    time timestamp with time zone,
    creator integer,
    code char(6),
    type char(1),
    PRIMARY KEY (id),
    FOREIGN KEY (creator) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS sesusers (
    sesid integer,
    uid integer,
    FOREIGN KEY (sesid) REFERENCES sessions (id),
    FOREIGN KEY (uid) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS documents (
    id serial,
    title text NOT NULL,
    path text NOT NULL,
    sesid integer,
    uploader integer,
    PRIMARY KEY (id),
    FOREIGN KEY (sesid) REFERENCES sessions (id),
    FOREIGN KEY (uploader) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS ideas (
    id serial,
    content text,
    descr text,
    serial varchar(255),
    iteration integer DEFAULT 1,
    uid integer,
    docid integer,
    PRIMARY KEY (id),
    FOREIGN KEY (uid) REFERENCES users (id),
    FOREIGN KEY (docid) REFERENCES documents (id)
);

CREATE TABLE IF NOT EXISTS questions (
    id serial,
    content text,
    options text,
    answer integer,
    comment text,
    other text,
    sesid integer,
    PRIMARY KEY (id),
    FOREIGN KEY (sesid) REFERENCES sessions (id)
);

CREATE TABLE IF NOT EXISTS selection (
    answer integer,
    uid integer,
    iteration integer DEFAULT 1,
    comment text,
    qid integer,
    PRIMARY KEY (uid, qid),
    FOREIGN KEY (uid) REFERENCES users (id),
    FOREIGN KEY (qid) REFERENCES questions (id)
);

CREATE TABLE IF NOT EXISTS teams (
    id serial,
    sesid integer,
    PRIMARY KEY (id),
    FOREIGN KEY (sesid) REFERENCES sessions (id)
);

CREATE TABLE IF NOT EXISTS teamusers (
    tmid integer,
    uid integer,
    FOREIGN KEY (tmid) REFERENCES teams (id),
    FOREIGN KEY (uid) REFERENCES users (id)
);

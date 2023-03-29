CREATE TABLE IF NOT EXISTS rubricas (
    id serial,
    sesid integer,
    PRIMARY KEY(id),
    FOREIGN KEY(sesid) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS reports (
    id serial,
    content text,
    example boolean DEFAULT false,
    rid integer,
    uid integer,
    PRIMARY KEY(id),
    FOREIGN KEY(rid) REFERENCES rubricas(id),
    FOREIGN KEY(uid) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS criteria (
    id serial,
    name text NOT NULL,
    pond integer NOT NULL,
    inicio text,
    proceso text,
    competente text,
    avanzado text,
    rid integer,
    PRIMARY KEY(id),
    FOREIGN KEY(rid) REFERENCES rubricas(id)
);

CREATE TABLE IF NOT EXISTS criteria_selection (
    id serial,
    selection integer,
    cid integer,
    uid integer,
    repid integer,
    PRIMARY KEY(id),
    FOREIGN KEY(cid) REFERENCES criteria(id),
    FOREIGN KEY(uid) REFERENCES users(id),
    FOREIGN KEY(repid) REFERENCES reports(id)
);

CREATE TABLE report_pair (
    id serial,
    uid integer,
    sesid integer,
    repid integer,
    PRIMARY KEY(id),
    FOREIGN KEY(uid) REFERENCES users(id),
    FOREIGN KEY(sesid) REFERENCES sessions(id),
    FOREIGN KEY(repid) REFERENCES reports(id)
);

CREATE TYPE tipo_aprendizaje AS ENUM('Reflexivo', 'Activo', 'Teorico', 'Pragmatico');
ALTER TABLE users ADD COLUMN aprendizaje tipo_aprendizaje;

ALTER TABLE teams ADD COLUMN leader integer;
ALTER TABLE teams ADD CONSTRAINT fk_leader FOREIGN KEY(leader) REFERENCES users(id);

CREATE TABLE status_record(
    sesid integer REFERENCES sessions(id),
    status integer,
    stime timestamp
);

CREATE TABLE finish_session(
    uid integer REFERENCES users(id),
    sesid integer REFERENCES sessions(id),
    status integer,
    stime timestamp
);

ALTER TABLE ideas ADD COLUMN stime timestamp;
ALTER TABLE selection ADD COLUMN stime timestamp;

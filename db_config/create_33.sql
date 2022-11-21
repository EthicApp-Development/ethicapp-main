ALTER TABLE sesusers ADD COLUMN device varchar(255);

CREATE TABLE IF NOT EXISTS drafts(
    id serial,
    sesid integer REFERENCES sessions(id),
    data text
);

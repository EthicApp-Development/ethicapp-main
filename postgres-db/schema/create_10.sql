CREATE TABLE semantic_document (
    id serial PRIMARY KEY,
    title text,
    content text,
    sesid integer REFERENCES sessions (id)
);

CREATE TABLE semantic_unit (
    id serial PRIMARY KEY,
    sentences integer [],
    comment text,
    uid integer REFERENCES users (id),
    docid integer REFERENCES semantic_document (id)
);

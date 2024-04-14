CREATE TABLE content_analysis (
    id SERIAL PRIMARY KEY,
    content text,
    context text,
    sesid integer REFERENCES sessions(id),
    stage_number integer
);
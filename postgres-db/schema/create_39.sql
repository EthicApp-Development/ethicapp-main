CREATE TABLE content_analysis (
    id SERIAL PRIMARY KEY,
    response_selections JSONB,
    context JSONB,
    sesid integer REFERENCES sessions(id),
    stage_id integer
);
CREATE TABLE content_analysis (
    id SERIAL PRIMARY KEY,
    response_selections text,
    context text,
    sesid integer REFERENCES sessions(id),
    stage_id integer
);

ALTER TABLE sessions ADD COLUMN additional_config JSONB NULL;
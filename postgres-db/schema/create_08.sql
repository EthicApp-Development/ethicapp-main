CREATE TABLE question_text (
    id serial,
    sesid integer REFERENCES sessions (id),
    title text,
    content text
);

ALTER TABLE questions ADD COLUMN textid integer DEFAULT null;

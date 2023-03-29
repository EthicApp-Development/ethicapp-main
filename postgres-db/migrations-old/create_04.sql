CREATE TABLE report_comment(
    uid integer REFERENCES users(id),
    repid integer REFERENCES reports(id),
    comment text
);

ALTER TABLE reports ADD COLUMN title text;

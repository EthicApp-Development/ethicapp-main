CREATE TABLE report_ideas(
    rid integer REFERENCES reports(id),
    idea_id integer REFERENCES ideas(id)
);

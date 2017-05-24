create table report_ideas(
    rid integer references reports(id),
    idea_id integer references ideas(id)
);
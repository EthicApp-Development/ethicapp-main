create table report_comment(
    uid integer references users(id),
    repid integer references reports(id),
    comment text
);

alter table reports add column title text;
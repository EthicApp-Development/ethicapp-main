alter table sesusers add column device varchar(255);

create table if not exists drafts(
    id serial,
    sesid integer references sessions(id),
    data text
);

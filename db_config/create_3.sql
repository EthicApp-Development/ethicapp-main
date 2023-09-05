create table status_record(
    sesid integer references sessions(id),
    status integer,
    stime timestamp
);

create table finish_session(
    uid integer references users(id),
    sesid integer references sessions(id),
    status integer,
    stime timestamp
);

alter table ideas add column stime timestamp;
alter table selection add column stime timestamp;
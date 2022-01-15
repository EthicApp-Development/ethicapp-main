create table if not exists designs (
    id serial,
    creator integer,
    design jsonb,
    foreign key(creator) references users(id)
);

alter table designs
    add public boolean default false;

alter table designs
    add locked boolean default false;

alter table designs
    add constraint designs_pk
        primary key (id);

create table if not exists designs_documents (
    id serial,
    path text not null,
    dsgnid integer,
    uploader integer,
    primary key(id),
    foreign key(dsgnid) references designs(id),
    foreign key(uploader) references users(id)
);

alter table designs_documents
    add active boolean default true;

alter table designs_documents
    drop constraint designs_documents_dsgnid_fkey;

alter table designs_documents
    add foreign key (dsgnid) references designs
        on delete cascade;

--GRANT SELECT ON TABLE designs_documents TO app;

create table if not exists activity (
    id serial,
    design integer,
    session integer,
    foreign key(design) references designs(id),
    foreign key(session) references sessions(id)
);

/*
GRANT SELECT ON TABLE designs TO app;
GRANT ALL PRIVILEGES ON TABLE designs TO app;
GRANT USAGE, SELECT ON SEQUENCE designs_id_seq TO app;

GRANT SELECT ON TABLE activity TO app;
GRANT ALL PRIVILEGES ON TABLE activity TO app;
GRANT USAGE, SELECT ON SEQUENCE activity_id_seq TO app;
GRANT ALL PRIVILEGES ON TABLE designs_documents TO app;
GRANT USAGE, SELECT ON SEQUENCE designs_documents_id_seq TO app;
*/

create table semantic_document(
    id serial primary key,
    title text,
    content text,
    sesid integer references sessions(id)
);

create table semantic_unit(
    id serial primary key,
    sentences integer[],
    comment text,
    uid integer references users(id),
    docid integer references semantic_document(id)
);
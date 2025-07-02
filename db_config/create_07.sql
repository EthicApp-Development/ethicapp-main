create table if not exists overlays (
    id serial,
    uid integer,
    qid integer,
    "type" varchar(1) not null, -- M: Marker, R: Rectangle, C: Circle, L: Polyline, P: Polygon, I: Image
    iteration integer,
    geom text not null,
    "name" varchar(255) not null,
    description text,
    primary key(id),
    foreign key(uid) references users(id),
    foreign key(qid) references questions(id)
);
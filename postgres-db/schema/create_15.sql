CREATE TABLE IF NOT EXISTS overlays (
    id serial,
    uid integer,
    qid integer,
    -- M: Marker, R: Rectangle, C: Circle, L: Polyline, P: Polygon, I: Image
    "type" varchar(1) NOT NULL,
    iteration integer,
    geom text NOT NULL,
    "name" varchar(255) NOT NULL,
    description text,
    PRIMARY KEY (id),
    FOREIGN KEY (uid) REFERENCES users (id),
    FOREIGN KEY (qid) REFERENCES questions (id)
);

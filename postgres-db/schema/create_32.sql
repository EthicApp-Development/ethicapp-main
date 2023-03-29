CREATE TABLE IF NOT EXISTS jigsaw_role(
    id serial,
    name varchar(255) NOT NULL,
    description text,
    sesid integer REFERENCES sessions(id),
    PRIMARY KEY(id)
);

CREATE TABLE IF NOT EXISTS jigsaw_users(
    stageid integer REFERENCES stages(id),
    userid integer REFERENCES users(id),
    roleid integer REFERENCES jigsaw_role(id)
);

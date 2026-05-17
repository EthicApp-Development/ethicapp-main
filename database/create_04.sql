CREATE TABLE IF NOT EXISTS jigsaw_role (
    id serial PRIMARY KEY,
    name varchar(255) NOT NULL,
    description text,
    sesid integer REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS jigsaw_users (
    phase_id integer REFERENCES phases(id),
    user_id integer REFERENCES users(id),
    role_id integer REFERENCES jigsaw_role(id)
);

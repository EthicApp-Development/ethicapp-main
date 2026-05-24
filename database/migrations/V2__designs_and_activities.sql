CREATE TABLE IF NOT EXISTS designs (
    id serial PRIMARY KEY,
    creator integer REFERENCES users(id),
    design jsonb,
    public boolean DEFAULT false,
    locked boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS activity (
    id serial PRIMARY KEY,
    design integer REFERENCES designs(id),
    session integer REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_session ON activity(session);
CREATE INDEX IF NOT EXISTS idx_activity_design ON activity(design);

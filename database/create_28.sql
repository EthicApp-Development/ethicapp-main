CREATE TABLE IF NOT EXISTS designs (
    id serial,
    creator integer,
    design jsonb,
    FOREIGN KEY (creator) REFERENCES users (id),
    public boolean DEFAULT false,
    locked boolean DEFAULT false
);

ALTER TABLE designs
ADD CONSTRAINT designs_pk
PRIMARY KEY (id);

CREATE TABLE IF NOT EXISTS activity (
    id serial PRIMARY KEY,
    design integer,
    session integer,
    FOREIGN KEY (design) REFERENCES designs (id),
    FOREIGN KEY (session) REFERENCES sessions (id)
);

CREATE INDEX idx_activity_session ON activity(session);
CREATE INDEX idx_activity_design ON activity(design);

CREATE TABLE IF NOT EXISTS ethical_cases (
    id serial PRIMARY KEY,
    title text NOT NULL,
    author_firstname text NOT NULL,
    author_lastname text NOT NULL,
    author_email text NOT NULL,
    pdf_path text NOT NULL,
    creator integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ethical_cases_creator ON ethical_cases(creator);

CREATE TABLE IF NOT EXISTS designs (
    id serial PRIMARY KEY,
    creator integer REFERENCES users(id),
    design jsonb,
    public boolean DEFAULT false,
    locked boolean DEFAULT false,
    case_id integer REFERENCES ethical_cases(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_designs_case_id ON designs(case_id);

CREATE TABLE IF NOT EXISTS activity (
    id serial PRIMARY KEY,
    design integer REFERENCES designs(id),
    session integer REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_session ON activity(session);
CREATE INDEX IF NOT EXISTS idx_activity_design ON activity(design);

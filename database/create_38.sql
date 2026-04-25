CREATE TABLE IF NOT EXISTS ethical_cases (
    id serial PRIMARY KEY,
    title text NOT NULL,
    author_firstname text NOT NULL,
    author_lastname text NOT NULL,
    author_email text NOT NULL,
    pdf_path text NOT NULL,
    creator integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ethical_cases_creator ON ethical_cases (creator);

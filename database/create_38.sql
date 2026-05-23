CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ethical_cases (
    id serial PRIMARY KEY,
    title text NOT NULL,
    author_firstname text NOT NULL,
    author_lastname text NOT NULL,
    author_email text NOT NULL,
    pdf_path text NOT NULL,
    creator integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamp without time zone DEFAULT NOW(),
    updated_at timestamp without time zone DEFAULT NOW(),
    case_uuid uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ethical_cases_case_uuid
    ON ethical_cases(case_uuid);

CREATE INDEX IF NOT EXISTS idx_ethical_cases_creator
    ON ethical_cases(creator);

ALTER TABLE designs
ADD COLUMN IF NOT EXISTS case_id integer;

ALTER TABLE designs
DROP CONSTRAINT IF EXISTS designs_case_id_fkey;

ALTER TABLE designs
ADD CONSTRAINT designs_case_id_fkey
FOREIGN KEY (case_id) REFERENCES ethical_cases(id)
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_designs_case_id
    ON designs(case_id);

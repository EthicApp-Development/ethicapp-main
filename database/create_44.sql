CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE ethical_cases
ADD COLUMN IF NOT EXISTS case_uuid uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_ethical_cases_case_uuid
    ON ethical_cases(case_uuid);

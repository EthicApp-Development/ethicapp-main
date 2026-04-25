ALTER TABLE designs
ADD COLUMN IF NOT EXISTS case_id integer;

ALTER TABLE designs
DROP CONSTRAINT IF EXISTS designs_case_id_fkey;

ALTER TABLE designs
ADD CONSTRAINT designs_case_id_fkey
FOREIGN KEY (case_id) REFERENCES ethical_cases (id)
ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_designs_case_id ON designs (case_id);

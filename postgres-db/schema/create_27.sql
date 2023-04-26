ALTER TABLE teams ADD COLUMN stageid integer REFERENCES stages (id);
ALTER TABLE actor_selection ADD COLUMN stime timestamp DEFAULT now();
ALTER TABLE actors ADD COLUMN justified boolean DEFAULT true;
ALTER TABLE stages ADD COLUMN question text;
ALTER TABLE stages ADD COLUMN grouping varchar(63);

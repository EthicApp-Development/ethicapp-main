ALTER TABLE teams ADD COLUMN stageid integer REFERENCES stages (id);
CREATE INDEX idx_teams_stageid ON teams(stageid);

ALTER TABLE actor_selection ADD COLUMN stime timestamp DEFAULT now();
ALTER TABLE actors ADD COLUMN justified boolean DEFAULT true;
ALTER TABLE stages ADD COLUMN question text;
ALTER TABLE stages ADD COLUMN grouping varchar(63);

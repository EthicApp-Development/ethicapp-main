ALTER TABLE teams ADD COLUMN original_leader integer REFERENCES users (id);

ALTER TABLE sessions ADD COLUMN current_stage integer REFERENCES stages(id);

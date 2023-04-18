ALTER TABLE differential_chat ADD PRIMARY KEY (id);
ALTER TABLE differential_chat ADD COLUMN parent_id integer REFERENCES differential_chat (id);

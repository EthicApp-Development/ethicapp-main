ALTER TABLE differential_chat
ADD COLUMN IF NOT EXISTS tmid integer references teams(id);

ALTER TABLE chat
ADD COLUMN IF NOT EXISTS tmid integer references teams(id);

CREATE INDEX IF NOT EXISTS idx_differential_chat_tmid ON differential_chat(tmid);
CREATE INDEX IF NOT EXISTS idx_chat_tmid ON chat(tmid);

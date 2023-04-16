ALTER TABLE differential ADD COLUMN stageid integer REFERENCES stages (id);
ALTER TABLE differential ADD COLUMN justify boolean DEFAULT true;
ALTER TABLE differential ADD COLUMN num integer DEFAULT 7;
ALTER TABLE stages ADD COLUMN options text;

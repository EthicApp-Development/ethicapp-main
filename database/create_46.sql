ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_confirmed boolean DEFAULT true;

UPDATE users
SET email_confirmed = true
WHERE email_confirmed IS NULL;

ALTER TABLE users
  ALTER COLUMN email_confirmed SET DEFAULT true;

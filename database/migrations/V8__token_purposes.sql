ALTER TABLE pass_reset
ADD COLUMN IF NOT EXISTS token_purpose varchar(40) NOT NULL DEFAULT 'password_reset';

CREATE INDEX IF NOT EXISTS idx_pass_reset_token_purpose
    ON pass_reset (token_purpose);

CREATE INDEX IF NOT EXISTS idx_pass_reset_mail_purpose
    ON pass_reset (lower(mail), token_purpose);

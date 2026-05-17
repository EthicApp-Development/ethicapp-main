CREATE TABLE IF NOT EXISTS pass_reset (
    id serial PRIMARY KEY,
    mail text NOT NULL,
    token varchar(64) NOT NULL,
    ctime timestamp
);

CREATE INDEX IF NOT EXISTS idx_pass_reset_mail ON pass_reset(mail);
CREATE INDEX IF NOT EXISTS idx_pass_reset_token ON pass_reset(token);

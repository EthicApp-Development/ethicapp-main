ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_bcrypt text,
  ADD COLUMN IF NOT EXISTS auth_provider varchar(20) DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS last_login_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_users_mail ON users(mail);
CREATE INDEX IF NOT EXISTS idx_users_rut ON users(rut);
CREATE INDEX IF NOT EXISTS idx_pass_reset_mail ON pass_reset(mail);
CREATE INDEX IF NOT EXISTS idx_pass_reset_token ON pass_reset(token);
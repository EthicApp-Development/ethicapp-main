ALTER TABLE users ADD COLUMN reset_password_token VARCHAR(255);
ALTER TABLE users ADD COLUMN reset_password_expires TIMESTAMP;
ALTER TABLE users ADD COLUMN validate_email_token VARCHAR(255);
ALTER TABLE users ADD COLUMN validate_email_expires TIMESTAMP;
ALTER TABLE users ADD COLUMN verified_email boolean default FALSE;
ALTER TABLE teacher_account_requests ADD COLUMN validate_email_token VARCHAR(255);
ALTER TABLE teacher_account_requests ADD COLUMN validate_email_expires TIMESTAMP;
ALTER TABLE teacher_account_requests ADD COLUMN verified_email boolean default FALSE;

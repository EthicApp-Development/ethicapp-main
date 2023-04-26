ALTER TABLE sesusers ADD CONSTRAINT no_dup_users UNIQUE (uid, sesid);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE mail IS NOT NULL
    GROUP BY mail
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add users.mail unique constraint: duplicate email addresses exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname IN ('users_mail_key', 'users_mail_unique')
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_mail_unique UNIQUE (mail);
  END IF;
END $$;

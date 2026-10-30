-- When each account was created (epic #879, sub-issue #878).
--
-- Design notes:
--
-- The column is added in two steps so that existing accounts are not stamped
-- with the time of this migration. Adding a column without a default leaves
-- every existing row NULL, which means "unknown": those accounts were created
-- before EthicApp recorded it. Setting the default afterwards only affects
-- rows inserted from then on, so every account-creation path (self sign-up,
-- professor registration, the auth-backend scripts) gets the time of its
-- insert without code changes. None of them sets the column explicitly.
--
-- The column stays nullable for that reason. Anonymization keeps it: the
-- creation time does not identify anyone and keeps the account's age for
-- audits.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS created_at timestamptz;

ALTER TABLE users
ALTER COLUMN created_at SET DEFAULT now();

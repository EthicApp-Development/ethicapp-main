-- Stop requiring the RUT and make email uniqueness ignore letter case
-- (epic #1067, sub-issue #1068).
--
-- Design notes:
--
-- A unique email identifies an account; the RUT (national ID) is being
-- retired. This migration only makes users.rut nullable, so the applications
-- can stop writing it. idx_users_rut stays until a later migration drops the
-- column and its index.
--
-- users_mail_unique (V1) compared emails as written, while sign-up, login and
-- the management console compare lower(mail). users_mail_lower_unique enforces
-- the rule they already apply, so two accounts can no longer have emails that
-- differ only in letter case. It also refuses exact duplicates, so
-- users_mail_unique is dropped: no statement or ON CONFLICT clause names it,
-- and keeping it would leave two indexes, and two constraint names, for the
-- same rule. idx_users_mail stays for lookups that compare mail as written.
--
-- If existing accounts already have emails that differ only in letter case,
-- the migration stops with an error that lists them and changes nothing
-- (Flyway rolls it back). Which account to keep is a decision about people's
-- data, so it is not made here; deploy/README.md ("Case-Insensitive Emails")
-- explains how to find and resolve them.
--
-- No data changes.

ALTER TABLE users
ALTER COLUMN rut DROP NOT NULL;

DO $$
DECLARE
    collisions text;
BEGIN
    SELECT
        string_agg(
            format('%s (users %s)', colliding.mail_key, colliding.user_ids),
            '; ' ORDER BY colliding.mail_key
        )
    INTO collisions
    FROM (
        SELECT
            lower(mail) AS mail_key,
            string_agg(id::text, ', ' ORDER BY id) AS user_ids
        FROM users
        GROUP BY lower(mail)
        HAVING count(*) > 1
    ) AS colliding;

    IF collisions IS NOT NULL THEN
        RAISE EXCEPTION 'Some accounts have emails that differ only in letter case: %', collisions
            USING HINT = 'See "Case-Insensitive Emails" in deploy/README.md to resolve them.';
    END IF;
END $$;

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_mail_unique;

CREATE UNIQUE INDEX users_mail_lower_unique ON users (lower(mail));

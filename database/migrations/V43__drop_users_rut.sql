-- Drop the retired RUT from user accounts (epic #1067, sub-issue #1072).
--
-- Design notes:
--
-- A unique email identifies an account (V42). Since #1069, #1070 and #1071,
-- no application writes or reads users.rut: sign-up, professor creation,
-- login, the bootstrap scripts, the management console's search and
-- anonymization, and the activity report exports no longer name it. The
-- column and its index go together.
--
-- The RUT values still stored, from accounts created before the RUT was
-- retired, are deleted with the column. By the epic's decision of 2026-11-04
-- they are not migrated anywhere else, and the column is not kept for a
-- release: the release that carries this migration also carries V42 and the
-- code that stopped using the column. Like any dropped column, the values can
-- only be recovered from a database backup taken before this migration.
--
-- No view, function or trigger depends on users.rut; idx_users_rut (V1) is
-- its only dependent object, and DROP COLUMN would drop it too. It is dropped
-- first, by name, so the migration says what it removes.

DROP INDEX IF EXISTS idx_users_rut;

ALTER TABLE users
DROP COLUMN rut;

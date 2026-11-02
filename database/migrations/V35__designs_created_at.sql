-- Creation time of each design (epic #965, sub-issue #967).
--
-- Design notes:
--
-- The launch wizard lists a teacher's designs by last launch, and a design
-- never launched by when it was created. The design document's
-- metainfo.creation_date cannot be used for that: nothing in the current
-- code sets it, some designs lack it, and a copy keeps its original's date.
--
-- Every insert into designs (a new design, a duplicate, an import, the
-- canonical activity seeds) leaves the column out, so the default dates each
-- row by its own insert, a copy included.
--
-- Existing designs stay null; they are not backfilled from
-- metainfo.creation_date. The column is added without a default and the
-- default is set afterwards: adding it with DEFAULT now() in one statement
-- would stamp every existing row with the time of this migration.

ALTER TABLE designs
ADD COLUMN created_at timestamptz;

ALTER TABLE designs
ALTER COLUMN created_at SET DEFAULT now();

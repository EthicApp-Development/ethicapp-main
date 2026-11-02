-- Let a design that has copies be deleted (epic #966, sub-issue #963).
--
-- Design notes:
--
-- A duplicate records its root design in original_design_id, and a design
-- imported from another teacher's public design records it in
-- imported_from_design_id. Both foreign keys were created in V6 with no
-- ON DELETE clause, so deleting a design that a copy points to failed.
--
-- With ON DELETE SET NULL, the copy stays and only loses the link. Its
-- attribution lives in source_design_title, source_design_author and
-- source_design_license_code, which are not touched.
--
-- activity_design_fkey stays NO ACTION: a design used by an activity must not
-- disappear, and DELETE /designs/:id answers 409 DESIGN_IN_USE before trying.
--
-- No data changes.

ALTER TABLE designs
DROP CONSTRAINT IF EXISTS designs_original_design_id_fkey,
ADD CONSTRAINT designs_original_design_id_fkey
FOREIGN KEY (original_design_id) REFERENCES designs (id) ON DELETE SET NULL;

ALTER TABLE designs
DROP CONSTRAINT IF EXISTS designs_imported_from_design_id_fkey,
ADD CONSTRAINT designs_imported_from_design_id_fkey
FOREIGN KEY (imported_from_design_id) REFERENCES designs (id)
ON DELETE SET NULL;

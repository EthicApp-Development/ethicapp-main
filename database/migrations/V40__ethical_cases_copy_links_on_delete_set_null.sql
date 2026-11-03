-- Let a case that has copies be deleted (epic #1008, sub-issue #1010).
--
-- Design notes:
--
-- A duplicate records its root case in original_case_id, and a case imported
-- from another teacher's public case records it in imported_from_case_id.
-- Both foreign keys were created in V6 with no ON DELETE clause, so deleting
-- a case that a copy points to failed with a foreign key violation.
--
-- With ON DELETE SET NULL, the copy stays and only loses the link. Its
-- attribution lives in source_case_title, source_case_author and
-- source_case_license_code, which are not touched.
--
-- designs_case_id_fkey stays ON DELETE SET NULL (V3): the owner's own designs
-- lose the case. DELETE /cases/:id answers 409 CASE_USED_BY_LAUNCHED_ACTIVITY
-- or CASE_USED_BY_OTHER_TEACHERS before deleting a case that an activity or
-- another teacher's design uses.
--
-- No data changes.

ALTER TABLE ethical_cases
DROP CONSTRAINT IF EXISTS ethical_cases_original_case_id_fkey,
ADD CONSTRAINT ethical_cases_original_case_id_fkey
FOREIGN KEY (original_case_id) REFERENCES ethical_cases (id)
ON DELETE SET NULL;

ALTER TABLE ethical_cases
DROP CONSTRAINT IF EXISTS ethical_cases_imported_from_case_id_fkey,
ADD CONSTRAINT ethical_cases_imported_from_case_id_fkey
FOREIGN KEY (imported_from_case_id) REFERENCES ethical_cases (id)
ON DELETE SET NULL;

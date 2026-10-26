-- Content type of a semantic differential question, copied from the design
-- with its text when a phase starts (#763).
--
-- differential.title holds the question text. title_content_type says how to
-- read it: 'text/plain' or 'text/markdown', the content types of
-- canonical-schemas/rich-text/README.md. NULL means the design declared none,
-- which is read as text/plain, as for every row created before this column.

ALTER TABLE differential ADD COLUMN IF NOT EXISTS title_content_type text NULL;

ALTER TABLE differential ADD CONSTRAINT differential_title_content_type_check
CHECK (title_content_type IN ('text/plain', 'text/markdown'));

ALTER TABLE semantic_unit ADD COLUMN docs integer[];
ALTER TABLE semantic_unit DROP COLUMN docid;
ALTER TABLE semantic_unit ADD COLUMN sesid integer REFERENCES sessions(id);

ALTER TABLE semantic_document ADD COLUMN orden integer;

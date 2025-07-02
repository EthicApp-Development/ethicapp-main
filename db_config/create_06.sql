alter table semantic_unit add column docs integer[];
alter table semantic_unit drop column docid;
alter table semantic_unit add column sesid integer references sessions(id);

alter table semantic_document add column orden integer;

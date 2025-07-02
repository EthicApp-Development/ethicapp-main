alter table differential_chat add primary key(id);
alter table differential_chat add column parent_id integer references differential_chat(id);
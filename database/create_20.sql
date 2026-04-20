alter table teams add column stageid integer references stages(id);
alter table actor_selection add column stime timestamp default now();
alter table actors add column justified boolean default true;
alter table stages add column question text;
alter table stages add column grouping varchar(63);

alter table differential add column stageid integer references stages(id);
alter table differential add column justify boolean default true;
alter table differential add column num integer default 7;
alter table stages add column options text;

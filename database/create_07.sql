alter table teams add column leader integer;
alter table teams add constraint fk_leader foreign key(leader) references users(id);

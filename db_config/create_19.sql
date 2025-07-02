alter table sessions add column current_stage integer references stages(id);

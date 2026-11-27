begin;
select no_plan();
select has_table('public','owner_material_movement_links','AC-005 attribution exists');
select has_function('public','om_material_lines', array['uuid','uuid','integer','integer'],'AC-003 material stages read');
select has_function('public','om_material_rollup',array['uuid','integer','integer','uuid'],'AC-004 portfolio read');
select has_table('public','owner_material_openings','AC-005 opening stage totals exist');
select has_function('public','om_material_config',array[]::text[],'AC-005 catalogues and scale read');
select has_function('public','om_material_set_scale',array['jsonb'],'AC-005 Admin scale writer');
select has_function('public','om_material_set_reconciliation',array['uuid','uuid','text'],'AC-005 reconciliation writer');
-- Behavioural fixtures follow once the schema contracts above are installed.
select * from finish();
rollback;

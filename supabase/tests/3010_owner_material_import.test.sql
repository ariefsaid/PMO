begin;
select plan(1);
select has_function('public','om_material_import',array['text','integer','jsonb','boolean'],'AC-006 resumable opening import');
select * from finish();
rollback;

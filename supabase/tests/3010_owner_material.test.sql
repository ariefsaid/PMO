begin;
select no_plan();
select has_table('public','owner_material_movement_links','AC-005 attribution exists');
select has_function('public','om_material_lines', array['uuid','uuid','integer','integer'],'AC-003 material stages read');
select has_function('public','om_material_rollup',array['uuid','integer','integer','uuid'],'AC-004 portfolio read');
select has_table('public','owner_material_openings','AC-005 opening stage totals exist');
select has_function('public','om_material_config',array[]::text[],'AC-005 catalogues and scale read');
select has_function('public','om_material_set_scale',array['jsonb'],'AC-005 Admin scale writer');
select has_function('public','om_material_set_reconciliation',array['uuid','uuid','text'],'AC-005 reconciliation writer');
insert into organizations (id, name, default_currency, default_timezone) values
  ('30100000-0000-0000-0000-00000000010a', 'OM Org', 'IDR', 'Asia/Jakarta'),
  ('30100000-0000-0000-0000-00000000010b', 'OM Other', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('30100000-0000-0000-0000-0000000001a1', 'om-admin@example.com'),
  ('30100000-0000-0000-0000-0000000001a2', 'om-req@example.com'),
  ('30100000-0000-0000-0000-0000000001a3', 'om-pm@example.com'),
  ('30100000-0000-0000-0000-0000000001b1', 'om-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('30100000-0000-0000-0000-0000000001a1', '30100000-0000-0000-0000-00000000010a', 'OM Admin', 'om-admin@example.com', 'Admin', 'active'),
  ('30100000-0000-0000-0000-0000000001a2', '30100000-0000-0000-0000-00000000010a', 'OM Req',   'om-req@example.com',   'Engineer', 'active'),
  ('30100000-0000-0000-0000-0000000001a3', '30100000-0000-0000-0000-00000000010a', 'OM PM',    'om-pm@example.com',    'Project Manager', 'active'),
  ('30100000-0000-0000-0000-0000000001b1', '30100000-0000-0000-0000-00000000010b', 'OM XOrg',  'om-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('30100000-0000-0000-0000-0000000001d1', '30100000-0000-0000-0000-00000000010a', 'OM Site', 'Ongoing Project', '30100000-0000-0000-0000-0000000001a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('30100000-0000-0000-0000-000000001401', '30100000-0000-0000-0000-00000000010a', '30100000-0000-0000-0000-0000000001d1', 'OM W',  'Issued', 10000, 'exclusive', 0),
  ('30100000-0000-0000-0000-000000001402', '30100000-0000-0000-0000-00000000010a', '30100000-0000-0000-0000-0000000001d1', 'OM W2', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('30100000-0000-0000-0000-000000001201', '30100000-0000-0000-0000-00000000010a', '30100000-0000-0000-0000-0000000001d1', 'B1', 'Slab', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('30100000-0000-0000-0000-00000000010a', '30100000-0000-0000-0000-000000001401', '30100000-0000-0000-0000-000000001201', 10);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('30100000-0000-0000-0000-000000001202', '30100000-0000-0000-0000-00000000010a', '30100000-0000-0000-0000-0000000001d1', 'B2', 'Wall', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('30100000-0000-0000-0000-00000000010a', '30100000-0000-0000-0000-000000001402', '30100000-0000-0000-0000-000000001202', 10);
insert into stock_units (id, org_id, code, name) values
  ('30100000-0000-0000-0000-000000001301', '30100000-0000-0000-0000-00000000010a', 'M', 'Metre');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('30100000-0000-0000-0000-000000001311', '30100000-0000-0000-0000-00000000010a', 'CBL', 'Cable', '30100000-0000-0000-0000-000000001301');
insert into boq_material_allowances (id, org_id, boq_item_id, item_id, planned_quantity) values
  ('30100000-0000-0000-0000-000000001321', '30100000-0000-0000-0000-00000000010a', '30100000-0000-0000-0000-000000001201', '30100000-0000-0000-0000-000000001311', 200),
  ('30100000-0000-0000-0000-000000001322', '30100000-0000-0000-0000-00000000010a', '30100000-0000-0000-0000-000000001202', '30100000-0000-0000-0000-000000001311', 50);

insert into work_order_sections(id,org_id,project_id,work_order_id,code,name) values
 ('30100000-0000-0000-0000-000000002001','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-0000000001d1','30100000-0000-0000-0000-000000001401','N','North'),
 ('30100000-0000-0000-0000-000000002002','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-0000000001d1','30100000-0000-0000-0000-000000001401','S','South');
insert into work_order_section_material_plan(id,org_id,work_order_id,section_id,item_id,quantity) values
 ('30100000-0000-0000-0000-000000003001','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001','30100000-0000-0000-0000-000000001311',1),
 ('30100000-0000-0000-0000-000000003002','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002002','30100000-0000-0000-0000-000000001311',100);
insert into owner_material_import_batches(id,org_id,source_key,schema_version,created_by) values
 ('30100000-0000-0000-0000-000000004001','30100000-0000-0000-0000-00000000010a','synthetic-read',2,'30100000-0000-0000-0000-0000000001a1');
insert into owner_material_openings(org_id,section_material_plan_id,as_of,received,import_batch_id,created_by) values
 ('30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000003001','2026-11-01',1,'30100000-0000-0000-0000-000000004001','30100000-0000-0000-0000-0000000001a1');
create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true);
$$;
set local role authenticated;
select pg_temp.act_as('30100000-0000-0000-0000-0000000001a1');
select is((select received_pct::numeric from om_material_rollup('30100000-0000-0000-0000-0000000001d1',1,1,'30100000-0000-0000-0000-000000001401')),50::numeric,'AC-004 line means use eligible lines, not quantities or page size');
select is((select total_count from om_material_lines('30100000-0000-0000-0000-000000001401',null,1,1)),2::bigint,'AC-004 total count precedes pagination');
select is((select issued_pct from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002002')),null::text,'AC-004 zero received denominator is absent');
select is(jsonb_array_length(om_material_config()->'steps'),5,'AC-005 working default scale');
select is((select received_pct::numeric from om_material_section_rollup('30100000-0000-0000-0000-000000001401') where section_code='N'),100::numeric,'AC-004 North retains its own eligible-line mean');
select is((select received_pct::numeric from om_material_section_rollup('30100000-0000-0000-0000-000000001401') where section_code='S'),0::numeric,'AC-004 South retains its different mean');
select throws_ok($$select * from om_material_lines('30100000-0000-0000-0000-000000001401',null,0,50)$$,'P0001','Invalid pagination','AC-004 reject invalid pagination');
reset role;
update owner_material_openings set received=10,issued=6,returned=1,transfer_out=2;
set local role authenticated;
select pg_temp.act_as('30100000-0000-0000-0000-0000000001a2');
select is((select closing::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),3::numeric,'AC-003 opening closing = 10 - 6 + 1 - 2');
select throws_ok($$select om_material_import('denied',2,'{}',true)$$,'42501','Admin required','AC-005 ordinary member cannot import');
select throws_ok($$select om_material_set_scale('[{"name":"Done","position":1,"percentage":"100"}]')$$,'42501','Admin required','AC-005 ordinary member cannot configure');
select throws_ok($$select om_material_set_reconciliation('30100000-0000-0000-0000-000000002001',(select id from owner_material_reconciliation_steps where position=1))$$,'42501',null,'AC-005 ordinary member cannot reconcile');
select throws_ok($$insert into owner_material_import_witness values(txid_current(),pg_backend_pid(),'30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-0000000001a2','30100000-0000-0000-0000-000000004001')$$,'42501',null,'AC-005 clients cannot forge import witnesses');
select throws_ok($$update owner_material_openings set received=100$$,'42501',null,'AC-005 opening direct writes denied');
select pg_temp.act_as('30100000-0000-0000-0000-0000000001b1');
select is((select count(*) from owner_material_openings),0::bigint,'AC-005 foreign organisation cannot read openings');
select is((select count(*) from om_material_lines('30100000-0000-0000-0000-000000001401')),0::bigint,'AC-005 foreign organisation cannot read lines');
select is((select count(*) from om_material_rollup('30100000-0000-0000-0000-0000000001d1')),0::bigint,'AC-005 foreign organisation cannot read rollup');
select is((select count(*) from om_material_section_rollup('30100000-0000-0000-0000-000000001401')),0::bigint,'AC-005 foreign organisation cannot read section rollup');
select is(jsonb_array_length(om_material_config()->'categories'),0,'AC-005 catalogue is organisation scoped');
select pg_temp.act_as('30100000-0000-0000-0000-0000000001a1');
select throws_ok($$update work_order_section_material_plan set quantity=201 where id='30100000-0000-0000-0000-000000003001'$$,'23514',null,'AC-005 Admin direct edits retain allocation cap without witness');
select throws_ok($$select * from owner_material_import_witness$$,'42501',null,'AC-005 witness is not client readable');
select lives_ok($$select om_material_set_scale('[{"name":"Prepared","position":1,"percentage":"20"},{"name":"Closed","position":2,"percentage":"100"}]')$$,'AC-005 Admin configures an ordered scale');
select throws_ok($$select om_material_set_scale('[{"name":"Checked","position":1,"percentage":"80"},{"name":"Prepared","position":2,"percentage":"20"}]')$$,'P0001','Percentages must increase','AC-005 scale percentages increase atomically');
select is(jsonb_array_length(om_material_config()->'steps'),2,'AC-005 failed scale change leaves accepted scale intact');
select lives_ok($$select om_material_set_reconciliation('30100000-0000-0000-0000-000000002001',(select id from owner_material_reconciliation_steps where archived_at is null and position=2),'Approved')$$,'AC-005 Admin records reconciliation');
select throws_ok($$select om_material_set_reconciliation('30100000-0000-0000-0000-000000002001',(select id from owner_material_reconciliation_steps where archived_at is null and position=1))$$,'P0001','Moving backwards requires a reason','AC-005 backwards transition requires reason');
select lives_ok($$select om_material_set_reconciliation('30100000-0000-0000-0000-000000002001',(select id from owner_material_reconciliation_steps where archived_at is null and position=1),'Recheck')$$,'AC-005 backwards transition with reason is audited');
select is((select count(*) from owner_material_reconciliation_events),2::bigint,'AC-005 status events preserve both changes');
select is((select reconciliation_pct::numeric from om_material_rollup('30100000-0000-0000-0000-0000000001d1',1,50,'30100000-0000-0000-0000-000000001401')),0::numeric,'AC-004 work order takes conservative minimum including unrecorded section');
reset role;
update organizations set built_in_roles_enabled=true where id='30100000-0000-0000-0000-00000000010a';
insert into auth.users(id,email) values
 ('30100000-0000-0000-0000-0000000001a4','om-material@example.com'),('30100000-0000-0000-0000-0000000001a5','om-keeper@example.com');
insert into profiles(id,org_id,full_name,email,role,status,built_in_role) values
 ('30100000-0000-0000-0000-0000000001a4','30100000-0000-0000-0000-00000000010a','OM Material','om-material@example.com','Engineer','active','material_coordinator'),
 ('30100000-0000-0000-0000-0000000001a5','30100000-0000-0000-0000-00000000010a','OM Keeper','om-keeper@example.com','Engineer','active','storekeeper');
set local role authenticated;
select pg_temp.act_as('30100000-0000-0000-0000-0000000001a4');
select lives_ok($$select om_material_set_reconciliation('30100000-0000-0000-0000-000000002002',(select id from owner_material_reconciliation_steps where archived_at is null and position=1))$$,'AC-005 Material Coordinator at Engineer access reconciles');
select throws_ok($$select om_material_import('mc',2,'{}',true)$$,'42501','Admin required','AC-005 Material Coordinator cannot bulk import');
select throws_ok($$select om_material_set_scale('[]')$$,'42501','Admin required','AC-005 Material Coordinator cannot configure scale');
select is((with changed as (update work_order_section_material_plan set quantity=500 where id='30100000-0000-0000-0000-000000003001' returning id) select count(*) from changed),0::bigint,'AC-005 Material Coordinator cannot bypass direct-plan rights');
select pg_temp.act_as('30100000-0000-0000-0000-0000000001a5');
select throws_ok($$select om_material_set_reconciliation('30100000-0000-0000-0000-000000002002',(select id from owner_material_reconciliation_steps where archived_at is null and position=1))$$,'42501',null,'AC-005 keeper does not inherit coordinator status rights');
select throws_ok($$select om_material_import('keeper',2,'{}',true)$$,'42501','Admin required','AC-005 keeper cannot bulk import');
select throws_ok($$select om_material_set_scale('[]')$$,'42501','Admin required','AC-005 keeper cannot configure scale');
select is((select count(*) from om_material_lines('30100000-0000-0000-0000-000000001401')),2::bigint,'AC-005 keeper can read stages');
reset role;
select ok(c.relrowsecurity and c.relforcerowsecurity,'AC-005 RLS enabled and forced: '||c.relname)
 from pg_class c where c.oid in ('stock_material_categories'::regclass,'owner_material_warehouses'::regclass,'owner_material_openings'::regclass,
 'owner_material_import_batches'::regclass,'owner_material_import_rows'::regclass,'owner_material_import_witness'::regclass,
 'owner_material_reconciliation_steps'::regclass,'owner_material_reconciliation'::regclass,'owner_material_reconciliation_events'::regclass,'owner_material_movement_links'::regclass);
select ok(not has_table_privilege('authenticated',c.oid,'INSERT') and not has_table_privilege('authenticated',c.oid,'UPDATE')
 and not has_table_privilege('authenticated',c.oid,'DELETE'),'AC-005 no direct client writes: '||c.relname)
 from pg_class c where c.relnamespace='public'::regnamespace and (c.relname like 'owner_material_%' and c.relkind='r' or c.relname='stock_material_categories');
select * from finish();
rollback;

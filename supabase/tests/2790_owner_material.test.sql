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
insert into stock_items(id,org_id,code,name,unit_id) values
 ('30100000-0000-0000-0000-000000001312','30100000-0000-0000-0000-00000000010a','ALT','Synthetic alternate','30100000-0000-0000-0000-000000001301');
insert into boq_material_allowances(org_id,boq_item_id,item_id,planned_quantity) values
 ('30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000001202','30100000-0000-0000-0000-000000001312',100);
insert into work_order_sections(id,org_id,project_id,work_order_id,code,name) values
 ('30100000-0000-0000-0000-000000002003','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-0000000001d1','30100000-0000-0000-0000-000000001402','P','Uneven north'),
 ('30100000-0000-0000-0000-000000002004','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-0000000001d1','30100000-0000-0000-0000-000000001402','Q','Uneven south');
insert into work_order_section_material_plan(id,org_id,work_order_id,section_id,item_id,quantity) values
 ('30100000-0000-0000-0000-000000003003','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000001402','30100000-0000-0000-0000-000000002003','30100000-0000-0000-0000-000000001311',1),
 ('30100000-0000-0000-0000-000000003004','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000001402','30100000-0000-0000-0000-000000002003','30100000-0000-0000-0000-000000001312',100),
 ('30100000-0000-0000-0000-000000003005','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000001402','30100000-0000-0000-0000-000000002004','30100000-0000-0000-0000-000000001311',1);
insert into owner_material_openings(org_id,section_material_plan_id,as_of,received,import_batch_id,created_by) values
 ('30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000003003','2026-11-01',1,'30100000-0000-0000-0000-000000004001','30100000-0000-0000-0000-0000000001a1');
set local role authenticated;
select is((select round(received_pct::numeric,3) from om_material_rollup('30100000-0000-0000-0000-0000000001d1',1,50,'30100000-0000-0000-0000-000000001402')),33.333::numeric,'AC-004 three eligible lines across uneven sections average to one third, not one quarter');
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
select throws_ok($$select om_material_set_scale('[{"name":"Renamed","position":1,"percentage":"20"},{"name":"Closed","position":2,"percentage":"100"}]')$$,
 'P0001','Scale step is in use','AC-005 v2.2 scale cannot rename a step used by a section');
select is((select reconciliation_step from om_material_section_rollup('30100000-0000-0000-0000-000000001401') where section_code='N'),'Prepared','AC-005 refused scale change preserves the section step');
select throws_ok($$select om_material_set_scale('[{"name":"Closed","position":2,"percentage":"100"}]')$$,
 'P0001','Scale step is in use','AC-005 scale cannot drop a step used by a section');
select throws_ok($$select om_material_set_scale('[{"name":"Prepared","position":1,"percentage":"40"},{"name":"Closed","position":2,"percentage":"100"}]')$$,
 'P0001','Scale step is in use','AC-005 scale cannot reinterpret a used percentage');
select throws_ok($$select om_material_set_scale('[{"name":"Prepared","position":3,"percentage":"20"},{"name":"Closed","position":4,"percentage":"100"}]')$$,
 'P0001','Scale step is in use','AC-005 scale cannot reorder a used step');
select lives_ok($$select om_material_set_scale('[{"name":"Prepared","position":1,"percentage":"20"},{"name":"Closed","position":2,"percentage":"100"}]')$$,
 'AC-005 identical scale preserves the active step identities');
select is((select reconciliation_pct::numeric from om_material_rollup('30100000-0000-0000-0000-0000000001d1',1,50,'30100000-0000-0000-0000-000000001401')),0::numeric,'AC-004 work order takes conservative minimum including unrecorded section');
reset role;
select throws_ok($$update owner_material_reconciliation_events set reason='Changed'$$,'P0001','CSR_IMMUTABLE: requisition history cannot be changed','AC-005 status history is immutable even for privileged writers');
select throws_ok($$insert into owner_material_openings(org_id,section_material_plan_id,as_of,import_batch_id,created_by)
 values('30100000-0000-0000-0000-00000000010b','30100000-0000-0000-0000-000000003004','2026-11-01','30100000-0000-0000-0000-000000004001','30100000-0000-0000-0000-0000000001b1')$$,
 '23503',null,'AC-005 opening cannot spoof parent organisation');
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
with changed as (update work_order_section_material_plan set quantity=500 where id='30100000-0000-0000-0000-000000003001' returning id) select is((select count(*) from changed),0::bigint,'AC-005 Material Coordinator cannot bypass direct-plan rights');
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

set local role authenticated;
select pg_temp.act_as('30100000-0000-0000-0000-0000000001b1');
select is((select count(*) from stock_material_categories where org_id='30100000-0000-0000-0000-00000000010a'),0::bigint,'AC-005 foreign tenant cannot read stock_material_categories');
select is((select count(*) from owner_material_warehouses where org_id='30100000-0000-0000-0000-00000000010a'),0::bigint,'AC-005 foreign tenant cannot read owner_material_warehouses');
select is((select count(*) from owner_material_import_batches where org_id='30100000-0000-0000-0000-00000000010a'),0::bigint,'AC-005 foreign tenant cannot read owner_material_import_batches');
select is((select count(*) from owner_material_import_rows where org_id='30100000-0000-0000-0000-00000000010a'),0::bigint,'AC-005 foreign tenant cannot read owner_material_import_rows');
select is((select count(*) from owner_material_openings where org_id='30100000-0000-0000-0000-00000000010a'),0::bigint,'AC-005 foreign tenant cannot read owner_material_openings');
select is((select count(*) from owner_material_reconciliation_steps where org_id='30100000-0000-0000-0000-00000000010a'),0::bigint,'AC-005 foreign tenant cannot read owner_material_reconciliation_steps');
select is((select count(*) from owner_material_reconciliation where org_id='30100000-0000-0000-0000-00000000010a'),0::bigint,'AC-005 foreign tenant cannot read owner_material_reconciliation');
select is((select count(*) from owner_material_reconciliation_events where org_id='30100000-0000-0000-0000-00000000010a'),0::bigint,'AC-005 foreign tenant cannot read owner_material_reconciliation_events');
select is((select count(*) from owner_material_movement_links where org_id='30100000-0000-0000-0000-00000000010a'),0::bigint,'AC-005 foreign tenant cannot read owner_material_movement_links');
select throws_ok($$select om_material_set_reconciliation('30100000-0000-0000-0000-000000002001',(select id from owner_material_reconciliation_steps limit 1))$$,'42501','Section unavailable','AC-005 foreign Admin cannot reconcile section');
reset role;
select set_config('request.jwt.claims','{}',true);
update profiles set status='disabled' where id='30100000-0000-0000-0000-0000000001a1';
set local role authenticated;
select pg_temp.act_as('30100000-0000-0000-0000-0000000001a1');
select throws_ok('select om_material_config()','42501','Active membership required','AC-005 inactive Admin cannot read configuration');
select throws_ok($$select om_material_import('inactive',2,'{}',true)$$,'42501',null,'AC-005 inactive Admin cannot import');
select throws_ok($$select om_material_set_scale('[]')$$,'42501',null,'AC-005 inactive Admin cannot configure');
select throws_ok($$select om_material_set_reconciliation('30100000-0000-0000-0000-000000002001',null)$$,'42501',null,'AC-005 inactive Admin cannot reconcile');
reset role;
select set_config('request.jwt.claims','{}',true);
update profiles set status='active' where id='30100000-0000-0000-0000-0000000001a1';
set local role anon;
select throws_ok($$select om_material_config()$$,'42501',null,'AC-005 anonymous config denied');
select throws_ok($$select om_material_import('anon',2,'{}',true)$$,'42501',null,'AC-005 anonymous import denied');
reset role;
-- Actual document -> document line -> ledger.line_id, plus explicit plan attribution.
select pg_temp.act_as('30100000-0000-0000-0000-0000000001a1');
insert into stock_warehouses(id,org_id,code,name,kind,project_id) values
 ('30100000-0000-0000-0000-000000006001','30100000-0000-0000-0000-00000000010a','OM-SITE','Synthetic site','site','30100000-0000-0000-0000-0000000001d1');
-- A legacy free receipt fixture uses the supported organisation setting, not a posting exception.
update order_receiving_settings set enabled=false where org_id='30100000-0000-0000-0000-00000000010a';
create temp table material_docs(kind text,id uuid);
grant all on material_docs to authenticated;
set local role authenticated;
insert into material_docs values('receive',create_stock_document(
 jsonb_build_object('kind','receive','warehouse_id','30100000-0000-0000-0000-000000006001'),
 '[{"item_id":"30100000-0000-0000-0000-000000001311","quantity":2,"unit_cost":0}]',true));
select set_cost_attribution('stock_document',array[(select id from material_docs where kind='receive')],'30100000-0000-0000-0000-000000001401',null);
insert into material_docs values('issue',create_stock_document(
 jsonb_build_object('kind','issue','warehouse_id','30100000-0000-0000-0000-000000006001','project_id','30100000-0000-0000-0000-0000000001d1'),
 '[{"item_id":"30100000-0000-0000-0000-000000001311","quantity":1,"boq_item_id":"30100000-0000-0000-0000-000000001201"}]',true));
select set_cost_attribution('stock_document',array[(select id from material_docs where kind='issue')],'30100000-0000-0000-0000-000000001401',null);
insert into material_docs values('return',create_stock_document(
 jsonb_build_object('kind','return','warehouse_id','30100000-0000-0000-0000-000000006001'),
 jsonb_build_array(jsonb_build_object('item_id','30100000-0000-0000-0000-000000001311','quantity','0.5',
 'source_line_id',(select l.id from stock_document_lines l join material_docs d on d.id=l.document_id where d.kind='issue'))),true));
select set_cost_attribution('stock_document',array[(select id from material_docs where kind='return')],'30100000-0000-0000-0000-000000001401',null);
create temp table material_transfer(id uuid);
grant all on material_transfer to authenticated;
insert into material_transfer select post_stock_wo_transfer(
 jsonb_build_object('warehouse_id','30100000-0000-0000-0000-000000006001','from_work_order_id','30100000-0000-0000-0000-000000001401',
 'to_work_order_id','30100000-0000-0000-0000-000000001402'),
 '[{"item_id":"30100000-0000-0000-0000-000000001311","quantity":"0.25","boq_item_id":"30100000-0000-0000-0000-000000001202"}]');
insert into material_docs values('unallocated',create_stock_document(
 jsonb_build_object('kind','receive','warehouse_id','30100000-0000-0000-0000-000000006001'),
 '[{"item_id":"30100000-0000-0000-0000-000000001311","quantity":1,"unit_cost":0}]',true));
select set_cost_attribution('stock_document',array[(select id from material_docs where kind='unallocated')],'30100000-0000-0000-0000-000000001401',null);
reset role;
insert into owner_material_movement_links(org_id,document_id,stock_line_id,section_material_plan_id,item_id,stage)
select l.org_id,l.document_id,l.id,'30100000-0000-0000-0000-000000003001',l.item_id,
 case d.kind when 'receive' then 'received' when 'return' then 'returned' else 'issued' end from stock_document_lines l join material_docs d on d.id=l.document_id where d.kind in ('receive','issue','return');
insert into owner_material_movement_links(org_id,document_id,stock_line_id,section_material_plan_id,item_id,stage)
select l.org_id,l.document_id,l.id,
 case d.kind when 'return' then '30100000-0000-0000-0000-000000003001'::uuid else '30100000-0000-0000-0000-000000003003'::uuid end,l.item_id,
 case d.kind when 'return' then 'transfer_out' else 'transfer_in' end
from stock_document_lines l join stock_documents d on d.id=l.document_id join material_transfer t on t.id=d.wo_transfer_id;
insert into client_requisitions(id,org_id,number,work_order_id,project_id,status,created_by) values
 ('30100000-0000-0000-0000-000000007001','30100000-0000-0000-0000-00000000010a','OM-LIVE','30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-0000000001d1','open','30100000-0000-0000-0000-0000000001a1');
insert into client_requisition_lines(id,org_id,requisition_id,line_no,stock_item_id,takeoff_quantity,requested_quantity,unit_code,section_material_plan_id) values
 ('30100000-0000-0000-0000-000000007002','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000007001',1,'30100000-0000-0000-0000-000000001311',7,7,'M','30100000-0000-0000-0000-000000003001');
insert into client_requisition_events(org_id,requisition_id,line_id,kind,quantity) values
 ('30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000007001','30100000-0000-0000-0000-000000007002','reserved',5),
 ('30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000007001','30100000-0000-0000-0000-000000007002','released',1);
insert into client_requisitions(id,org_id,number,work_order_id,project_id,status,created_by) values
 ('30100000-0000-0000-0000-000000007003','30100000-0000-0000-0000-00000000010a','OM-OTHER-WO','30100000-0000-0000-0000-000000001402','30100000-0000-0000-0000-0000000001d1','open','30100000-0000-0000-0000-0000000001a1');
select throws_ok($$insert into client_requisition_lines(org_id,requisition_id,line_no,stock_item_id,takeoff_quantity,requested_quantity,unit_code,section_material_plan_id)
 values('30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000007003',1,'30100000-0000-0000-0000-000000001311',1,1,'M','30100000-0000-0000-0000-000000003001')$$,
 '23514','Material parent mismatch','AC-005 same-org requisition cannot link another work order plan');
set local role authenticated;
select is((select received::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),12::numeric,'AC-003 opening 10 plus posted receipt 2');
select is((select issued::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),7::numeric,'AC-003 opening 6 plus posted issue 1');
select is((select requested::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),7::numeric,'AC-003 live linked request contributes');
select is((select set_aside::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),4::numeric,'AC-003 reservation releases net before adding');
select is((select returned::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),1.5::numeric,'AC-003 opening return plus live return');
select is((select transfer_out::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),2.25::numeric,'AC-003 outbound work-order transfer uses its attributed return half');
select is((select transfer_in::numeric from om_material_lines('30100000-0000-0000-0000-000000001402') where plan_id='30100000-0000-0000-0000-000000003003'),0.25::numeric,'AC-003 inbound work-order transfer uses its attributed issue half');
select is((select received::numeric from om_material_lines('30100000-0000-0000-0000-000000001402') where plan_id='30100000-0000-0000-0000-000000003003'),10::numeric,'AC-003 transfer does not become another receipt');
select is((select closing::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),4.25::numeric,'AC-003 closing combines opening and all live contributions');
select is((select unallocated_movement_count from om_material_rollup('30100000-0000-0000-0000-0000000001d1',1,50,'30100000-0000-0000-0000-000000001401')),0::bigint,'AC-003 bought-stock history is outside owner material unplaced figures');
select pg_temp.act_as('30100000-0000-0000-0000-0000000001b1');
select is((select count(*) from owner_material_posted_quantities),0::bigint,'AC-005 foreign tenant cannot read quantity projection');
select is((select count(*) from owner_material_unallocated_totals),0::bigint,'AC-005 foreign tenant cannot read unallocated projection');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into auth.users(id,email) values('30100000-0000-0000-0000-0000000001a6','om-phone@example.com');
insert into profiles(id,org_id,full_name,email,role,status,built_in_role) values
 ('30100000-0000-0000-0000-0000000001a6','30100000-0000-0000-0000-00000000010a','OM Phone','om-phone@example.com','Engineer','active','foreman');
insert into crews(id,org_id,code,name,field_controller_id) values
 ('30100000-0000-0000-0000-000000008001','30100000-0000-0000-0000-00000000010a','OM-CREW','Synthetic crew','30100000-0000-0000-0000-0000000001a6');
insert into work_order_crews(org_id,work_order_id,crew_id,valid_from) values
 ('30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000008001',current_date);
select ok((select count(*) from owner_material_reconciliation_steps where org_id='30100000-0000-0000-0000-00000000010a')>0,'AC-LA-014 fixture org holds reconciliation steps, so the phone zero is not vacuous');
set local role authenticated;
select pg_temp.act_as('30100000-0000-0000-0000-0000000001a6');
select ok(light_can_see_work_order('30100000-0000-0000-0000-000000001401'),'AC-005 phone fixture has its current crew assignment');
select is((select count(*) from owner_material_posted_quantities),0::bigint,'AC-005 phone scope excludes material movement quantities');
select is((select count(*) from owner_material_unallocated_totals),0::bigint,'AC-005 phone scope excludes unallocated quantities');
-- AC-LA-014 a field account reads no row of any owner-material table (restrictive light_account_deny_select).
-- MUTATION: drop policy light_account_deny_select on owner_material_reconciliation_steps -> the steps case goes red.
select is((select count(*) from owner_material_reconciliation_steps),0::bigint,'AC-LA-014 phone reads no owner_material_reconciliation_steps row');
select is((select count(*) from stock_material_categories),0::bigint,'AC-LA-014 phone reads no stock_material_categories row');
select is((select count(*) from owner_material_warehouses),0::bigint,'AC-LA-014 phone reads no owner_material_warehouses row');
select is((select count(*) from owner_material_import_batches),0::bigint,'AC-LA-014 phone reads no owner_material_import_batches row');
select is((select count(*) from owner_material_import_rows),0::bigint,'AC-LA-014 phone reads no owner_material_import_rows row');
select is((select count(*) from owner_material_openings),0::bigint,'AC-LA-014 phone reads no owner_material_openings row');
select is((select count(*) from owner_material_reconciliation),0::bigint,'AC-LA-014 phone reads no owner_material_reconciliation row');
select is((select count(*) from owner_material_reconciliation_events),0::bigint,'AC-LA-014 phone reads no owner_material_reconciliation_events row');
select is((select count(*) from owner_material_movement_links),0::bigint,'AC-LA-014 phone reads no owner_material_movement_links row');
select ok(not has_table_privilege('authenticated','public.owner_material_import_witness','SELECT'),'AC-LA-014 the import witness has no signed-in read grant');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into stock_tags(id,org_id,name,zero_cost) values('30100000-0000-0000-0000-000000009001','30100000-0000-0000-0000-00000000010a','Synthetic owner tag',true);
set local role authenticated;
select pg_temp.act_as('30100000-0000-0000-0000-0000000001a1');
select is((select unallocated_movement_count from om_material_rollup('30100000-0000-0000-0000-0000000001d1',1,50,'30100000-0000-0000-0000-000000001401')),0::bigint,'AC-003 bought-stock lines are excluded from owner-material unplaced count');
reset role;
-- This fixture changes the tag before any tagged stock is moved; use a distinct owner item.
select set_config('request.jwt.claims','{}',true);
insert into stock_items(id,org_id,code,name,unit_id,tag_id) values
 ('30100000-0000-0000-0000-000000009002','30100000-0000-0000-0000-00000000010a','OWNER-ONLY','Synthetic owner item','30100000-0000-0000-0000-000000001301','30100000-0000-0000-0000-000000009001');
set local role authenticated;
select pg_temp.act_as('30100000-0000-0000-0000-0000000001a1');
insert into material_docs values('owner-unallocated',create_stock_document(
 jsonb_build_object('kind','receive','warehouse_id','30100000-0000-0000-0000-000000006001'),
 '[{"item_id":"30100000-0000-0000-0000-000000009002","quantity":1,"unit_cost":0}]',true));
select set_cost_attribution('stock_document',array[(select id from material_docs where kind='owner-unallocated')],'30100000-0000-0000-0000-000000001401',null);
select is((select unallocated_movement_count from om_material_rollup('30100000-0000-0000-0000-0000000001d1',1,50,'30100000-0000-0000-0000-000000001401')),1::bigint,'AC-003 owner-supplied unplaced line is counted');
reset role;
set local role authenticated;
insert into material_docs values('fulfilled',create_stock_document(
 jsonb_build_object('kind','receive','warehouse_id','30100000-0000-0000-0000-000000006001'),
 '[{"item_id":"30100000-0000-0000-0000-000000001311","quantity":7,"unit_cost":0}]',true));
reset role;
insert into client_requisition_pickups(org_id,requisition_id,line_id,quantity,picked_up_on,warehouse_id,stock_document_id,recorded_by)
values('30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000007001','30100000-0000-0000-0000-000000007002',7,current_date,
 '30100000-0000-0000-0000-000000006001',(select id from material_docs where kind='fulfilled'),'30100000-0000-0000-0000-0000000001a1');
set local role authenticated;
select is((select sum(quantity) from client_requisition_pickups where line_id='30100000-0000-0000-0000-000000007002'),7::numeric,'AC-003 open requisition fixture is fully collected');
select is((select requested::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),7::numeric,'AC-003 fully collected open requisition remains Requested');
reset role;
update client_requisitions set status='draft' where id='30100000-0000-0000-0000-000000007001';
set local role authenticated;
select is((select requested::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),0::numeric,'AC-003 draft requisitions are not yet Requested from the owner');
reset role;
update client_requisitions set status='cancelled' where id='30100000-0000-0000-0000-000000007001';
set local role authenticated;
select is((select requested::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),0::numeric,'AC-003 cancelled requisition contributes no Requested quantity');
reset role;
-- The native reversal writes its correcting movement and immutable reversal witness.
insert into companies(id,org_id,name,type) values('30100000-0000-0000-0000-000000009104','30100000-0000-0000-0000-00000000010a','Synthetic supplier','Vendor');
insert into procurements(id,org_id,title,status,currency,requested_by_id,total_value,approved_total_value,approved_by_id,vendor_id) values
 ('30100000-0000-0000-0000-000000009101','30100000-0000-0000-0000-00000000010a','Synthetic order receipt','Ordered','IDR','30100000-0000-0000-0000-0000000001a2',0,0,'30100000-0000-0000-0000-0000000001a1','30100000-0000-0000-0000-000000009104');
insert into purchase_orders(id,org_id,procurement_id,po_number,status,currency) values
 ('30100000-0000-0000-0000-000000009102','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000009101','OM-SYN-PO','Issued','IDR');
insert into order_receiving_requests(id,org_id,po_id,receiver_id,warehouse_id,receipt_date,counted_lines,stock_document_id) values
 ('30100000-0000-0000-0000-000000009103','30100000-0000-0000-0000-00000000010a','30100000-0000-0000-0000-000000009102','30100000-0000-0000-0000-0000000001a2',
 '30100000-0000-0000-0000-000000006001',current_date,'[]',(select id from material_docs where kind='receive'));
set local role authenticated;
select set_order_receiving_enabled(true);
select lives_ok($$select reverse_order_receiving('30100000-0000-0000-0000-000000009103','Synthetic correction')$$,'AC-003 native receipt reversal posts a correction');
select is((select received::numeric from om_material_lines('30100000-0000-0000-0000-000000001401','30100000-0000-0000-0000-000000002001')),10::numeric,'AC-003 reversed receipt no longer adds to opening received');
reset role;
select * from finish();
rollback;

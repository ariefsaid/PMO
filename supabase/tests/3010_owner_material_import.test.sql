begin;
select no_plan();
select has_function('public','om_material_import',array['text','integer','jsonb','boolean'],'AC-006 resumable opening import');
insert into organizations (id, name, default_currency, default_timezone) values
  ('30110000-0000-0000-0000-00000000010a', 'OMI Org', 'IDR', 'Asia/Jakarta'),
  ('30110000-0000-0000-0000-00000000010b', 'OMI Other', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('30110000-0000-0000-0000-0000000001a1', 'omi-admin@example.com'),
  ('30110000-0000-0000-0000-0000000001a2', 'omi-req@example.com'),
  ('30110000-0000-0000-0000-0000000001a3', 'omi-pm@example.com'),
  ('30110000-0000-0000-0000-0000000001b1', 'omi-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('30110000-0000-0000-0000-0000000001a1', '30110000-0000-0000-0000-00000000010a', 'OMI Admin', 'omi-admin@example.com', 'Admin', 'active'),
  ('30110000-0000-0000-0000-0000000001a2', '30110000-0000-0000-0000-00000000010a', 'OMI Req',   'omi-req@example.com',   'Engineer', 'active'),
  ('30110000-0000-0000-0000-0000000001a3', '30110000-0000-0000-0000-00000000010a', 'OMI PM',    'omi-pm@example.com',    'Project Manager', 'active'),
  ('30110000-0000-0000-0000-0000000001b1', '30110000-0000-0000-0000-00000000010b', 'OMI XOrg',  'omi-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('30110000-0000-0000-0000-0000000001d1', '30110000-0000-0000-0000-00000000010a', 'OMI Site', 'Ongoing Project', '30110000-0000-0000-0000-0000000001a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('30110000-0000-0000-0000-000000001401', '30110000-0000-0000-0000-00000000010a', '30110000-0000-0000-0000-0000000001d1', 'OMI W',  'Issued', 10000, 'exclusive', 0),
  ('30110000-0000-0000-0000-000000001402', '30110000-0000-0000-0000-00000000010a', '30110000-0000-0000-0000-0000000001d1', 'OMI W2', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('30110000-0000-0000-0000-000000001201', '30110000-0000-0000-0000-00000000010a', '30110000-0000-0000-0000-0000000001d1', 'B1', 'Slab', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('30110000-0000-0000-0000-00000000010a', '30110000-0000-0000-0000-000000001401', '30110000-0000-0000-0000-000000001201', 10);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('30110000-0000-0000-0000-000000001202', '30110000-0000-0000-0000-00000000010a', '30110000-0000-0000-0000-0000000001d1', 'B2', 'Wall', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('30110000-0000-0000-0000-00000000010a', '30110000-0000-0000-0000-000000001402', '30110000-0000-0000-0000-000000001202', 10);
insert into stock_units (id, org_id, code, name) values
  ('30110000-0000-0000-0000-000000001301', '30110000-0000-0000-0000-00000000010a', 'M', 'Metre');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('30110000-0000-0000-0000-000000001311', '30110000-0000-0000-0000-00000000010a', 'CBL', 'Cable', '30110000-0000-0000-0000-000000001301');
insert into boq_material_allowances (id, org_id, boq_item_id, item_id, planned_quantity) values
  ('30110000-0000-0000-0000-000000001321', '30110000-0000-0000-0000-00000000010a', '30110000-0000-0000-0000-000000001201', '30110000-0000-0000-0000-000000001311', 100),
  ('30110000-0000-0000-0000-000000001322', '30110000-0000-0000-0000-00000000010a', '30110000-0000-0000-0000-000000001202', '30110000-0000-0000-0000-000000001311', 50);
update work_orders set client_po_number='OMI-ORDER' where id='30110000-0000-0000-0000-000000001401';
insert into stock_tags(id,org_id,name,zero_cost) values('30110000-0000-0000-0000-000000005001','30110000-0000-0000-0000-00000000010a','Owner material',true);
update stock_items set tag_id='30110000-0000-0000-0000-000000005001' where id='30110000-0000-0000-0000-000000001311';
create function pg_temp.act_as(p_uid uuid) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true);
$$;
create function pg_temp.payload(p_hash text default 'v1',p_planned text default '250',p_received text default '10',p_issued text default '6',p_closing text default '4') returns jsonb language sql as $$
 select jsonb_build_object('kind','section','project_id','30110000-0000-0000-0000-0000000001d1','source_digest','synthetic',
 'entities',jsonb_build_array(jsonb_build_object('entity_key','section-north','hash',p_hash,'sheet','North','row',2,
 'owner_order_number','OMI-ORDER','location_name','North','section_code','N','owner_cost_code','SYNTHETIC','as_of','2026-11-01',
 'lines',jsonb_build_array(jsonb_build_object('entity_key','line-cable','hash',p_hash,'row',3,'item_code','CBL','unit','M','planned',p_planned,
 'opening',jsonb_build_object('requested','12','set_aside','11','received',p_received,'issued',p_issued,'returned','0','transfer_in','0','transfer_out','0','owner_return','0'),
 'evidence',jsonb_build_object('dates','2026-10-01; 2026-10-04','reference','SYN-01 / SYN-02'),
 'expected',jsonb_build_object('closing',p_closing))))));
$$;
create temp table results(k text primary key,v jsonb);
grant all on results to authenticated;
set local role authenticated;
select pg_temp.act_as('30110000-0000-0000-0000-0000000001a1');
insert into results values('preview',om_material_import('synthetic-opening',2,pg_temp.payload(),false));
select is((select v->>'complete' from results where k='preview'),'true','AC-006 preview accepts complete section');
select is((select count(*) from owner_material_openings),0::bigint,'AC-006 preview writes no openings');
select is((select count(*) from owner_material_import_batches),0::bigint,'AC-006 preview writes no batch');
insert into results values('create',om_material_import('synthetic-opening',2,pg_temp.payload(),true));
select is((select v->>'complete' from results where k='create'),'true','AC-006 confirmed section imports');
select is((select v->'results'->0->>'status' from results where k='create'),'create','AC-006 initial import creates');
select is((select count(*) from owner_material_openings),1::bigint,'AC-006 one opening per plan');
select is((select quantity from work_order_section_material_plan),250::numeric,'AC-006 private witness allows opening plan above live cap');
select ok((select import_batch_id is not null from work_order_section_material_plan),'AC-006 exception records import batch');
select is((select closing::numeric from om_material_lines('30110000-0000-0000-0000-000000001401')),4::numeric,'AC-003 imported opening arithmetic');
select is((select evidence->>'reference' from om_material_lines('30110000-0000-0000-0000-000000001401')),'SYN-01 / SYN-02','AC-003 source text retained verbatim');
select is((select count(*) from stock_documents where work_order_id='30110000-0000-0000-0000-000000001401'),0::bigint,'AC-006 material import posts no stock document');
select is((select count(*) from client_requisitions where work_order_id='30110000-0000-0000-0000-000000001401'),0::bigint,'AC-006 material import creates no requisition');
select is(om_material_import('synthetic-opening',2,pg_temp.payload(),true)->'results'->0->>'status','skip','AC-006 identical source repeat skips');
select throws_ok($$update work_order_section_material_plan set quantity=251$$,'23514',null,'AC-005 later live edit of imported plan retains cap');
select throws_ok($$insert into owner_material_import_witness values(txid_current(),pg_backend_pid(),'30110000-0000-0000-0000-00000000010a','30110000-0000-0000-0000-0000000001a1',(select id from owner_material_import_batches))$$,'42501',null,'AC-005 even Admin cannot create witness directly');
insert into results values('update',om_material_import('synthetic-opening',2,pg_temp.payload('v2','300','12','2','10'),true));
select is((select v->>'complete' from results where k='update'),'true','AC-006 changed opening updates');
select is((select v->'results'->0->>'status' from results where k='update'),'update','AC-006 changed source reports update');
select is((select quantity from work_order_section_material_plan),300::numeric,'AC-006 plan quantity updated');
select is((select received from owner_material_openings),12::numeric,'AC-006 opening totals updated');
insert into results values('refused',om_material_import('synthetic-opening',2,pg_temp.payload('v3','400','1','2','-1'),true));
select is((select v->>'complete' from results where k='refused'),'false','AC-006 negative closing refused');
select is((select quantity from work_order_section_material_plan),300::numeric,'AC-006 refused section leaves plan unchanged');
select is((select received from owner_material_openings),12::numeric,'AC-006 refused section leaves opening unchanged');
insert into results values('flagged',om_material_import('synthetic-opening',2,jsonb_set(pg_temp.payload('v3','400','1','2','-1'),'{entities,0,closing_conflict}','"movements_win"'),true));
select is((select v->>'complete' from results where k='flagged'),'true','AC-006 explicit movements policy accepts position');
select is((select v->'results'->0->>'flagged' from results where k='flagged'),'true','AC-006 policy exception is flagged');
select is(om_material_import('missing-order',2,jsonb_set(pg_temp.payload(),'{entities,0,owner_order_number}','"NO-SUCH-ORDER"'),true)->'results'->0->>'reason','material-work-order-missing','AC-006 missing work order refused without inventing commercial inputs');
select pg_temp.act_as('30110000-0000-0000-0000-0000000001a2');
select throws_ok($$select om_material_import('denied',2,pg_temp.payload(),true)$$,'42501','Admin required','AC-005 member cannot import');
select pg_temp.act_as('30110000-0000-0000-0000-0000000001b1');
select throws_ok($$select om_material_import('foreign',2,pg_temp.payload(),true)$$,'42501','Project unavailable','AC-005 foreign Admin cannot import into project');
select is((select count(*) from owner_material_openings),0::bigint,'AC-005 foreign Admin cannot see opening');
select * from finish();
rollback;

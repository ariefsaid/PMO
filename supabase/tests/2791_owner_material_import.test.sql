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
  ('30110000-0000-0000-0000-000000001401', '30110000-0000-0000-0000-00000000010a', '30110000-0000-0000-0000-0000000001d1', 'OMI W',  'Draft', 0, 'exclusive', 0),
  ('30110000-0000-0000-0000-000000001402', '30110000-0000-0000-0000-00000000010a', '30110000-0000-0000-0000-0000000001d1', 'OMI W2', 'Draft', 0, 'exclusive', 0);
insert into stock_units (id, org_id, code, name) values
  ('30110000-0000-0000-0000-000000001301', '30110000-0000-0000-0000-00000000010a', 'M', 'Metre'),
  ('30110000-0000-0000-0000-000000001302', '30110000-0000-0000-0000-00000000010b', 'EA', 'Foreign each');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('30110000-0000-0000-0000-000000001311', '30110000-0000-0000-0000-00000000010a', 'CBL', 'Cable', '30110000-0000-0000-0000-000000001301');
update work_orders set client_po_number='OMI-ORDER' where id='30110000-0000-0000-0000-000000001401';
insert into stock_tags(id,org_id,name,zero_cost) values('30110000-0000-0000-0000-000000005001','30110000-0000-0000-0000-00000000010a','Owner material',true);
update stock_items set tag_id='30110000-0000-0000-0000-000000005001' where id='30110000-0000-0000-0000-000000001311';
insert into auth.users(id,email) values('30110000-0000-0000-0000-0000000001a4','omi-second-admin@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('30110000-0000-0000-0000-0000000001a4','30110000-0000-0000-0000-00000000010a','OMI Second Admin','omi-second-admin@example.com','Admin','active');
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
select is((select quantity from work_order_section_material_plan),250::numeric,'AC-006 private witness imports a Draft plan with no commercial lines and zero live cap');
select ok((select import_batch_id is not null from work_order_section_material_plan),'AC-006 exception records import batch');
select is((select closing::numeric from om_material_lines('30110000-0000-0000-0000-000000001401')),4::numeric,'AC-003 imported opening arithmetic');
select is((select evidence->>'reference' from om_material_lines('30110000-0000-0000-0000-000000001401')),'SYN-01 / SYN-02','AC-003 source text retained verbatim');
select is((select count(*) from stock_documents where work_order_id='30110000-0000-0000-0000-000000001401'),0::bigint,'AC-006 material import posts no stock document');
select is((select count(*) from client_requisitions where work_order_id='30110000-0000-0000-0000-000000001401'),0::bigint,'AC-006 material import creates no requisition');
select is(om_material_import('synthetic-opening',2,pg_temp.payload(),true)->'results'->0->>'status','skip','AC-006 identical source repeat skips');
select pg_temp.act_as('30110000-0000-0000-0000-0000000001a4');
select is(om_material_import('synthetic-opening',2,pg_temp.payload(),true)->'results'->0->>'status','skip','AC-006 another Admin resumes the same source');
select pg_temp.act_as('30110000-0000-0000-0000-0000000001a1');
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
select is((select closing_pct from om_material_lines('30110000-0000-0000-0000-000000001401')),null::text,'AC-004 flagged negative closing has no percentage');
select is((select closing_pct from om_material_rollup('30110000-0000-0000-0000-0000000001d1',1,50,'30110000-0000-0000-0000-000000001401')),null::text,'AC-004 work-order mean excludes flagged negative closing');
select is((select closing_pct from om_material_section_rollup('30110000-0000-0000-0000-000000001401')),null::text,'AC-004 section mean excludes flagged negative closing');
select is(om_material_import('missing-order',2,jsonb_set(pg_temp.payload(),'{entities,0,owner_order_number}','"NO-SUCH-ORDER"'),true)->'results'->0->>'reason_code','material-work-order-missing','AC-006 missing work order refused without inventing commercial inputs');
select is(om_material_import('synthetic-opening',2,jsonb_set(jsonb_set(pg_temp.payload('v4','450','5','1','4'),'{entities,0,lines}',
 jsonb_build_array(pg_temp.payload('v4','450','5','1','4')->'entities'->0->'lines'->0,
 jsonb_set(jsonb_set(pg_temp.payload()->'entities'->0->'lines'->0,'{entity_key}','"zz-failing"'),'{item_code}','"NO-SUCH-ITEM"'))),'{entities,0,reconciliation_step}','"Prepared"'),true)->>'complete','false','AC-006 failing later line refuses the complete section');
select is((select quantity from work_order_section_material_plan),400::numeric,'AC-006 failure after first line restores earlier plan update');
select is((select received from owner_material_openings),1::numeric,'AC-006 failure after first line restores earlier opening update');
select is(om_material_import('synthetic-opening',2,jsonb_set(pg_temp.payload('v5','450','5','1','4'),'{entities,0,reconciliation_step}','"Prepared"'),true)->>'complete','true','AC-006 opening imports optional reconciliation step');
select is((select reconciliation_step from om_material_section_rollup('30110000-0000-0000-0000-000000001401')),'Prepared','AC-006 imported reconciliation is readable by location');
insert into results values('catalogue',om_material_import('synthetic-catalogue',2,
 jsonb_build_object('kind','catalogue','project_id','30110000-0000-0000-0000-0000000001d1','entities',jsonb_build_array(
 jsonb_build_object('entity_key','catalogue-category','hash','cat-v1','type','category','code','SYN-CAT','name','Synthetic category'),
 jsonb_build_object('entity_key','catalogue-warehouse','hash','wh-v1','type','owner_warehouse','code','SYN-WH','name','Synthetic owner warehouse'),
 jsonb_build_object('entity_key','catalogue-item','hash','item-v1','type','item','code','000-SYN','name','Synthetic new item','unit','M','zero_cost_tag_id','30110000-0000-0000-0000-000000005001'))),true));
select is((select v->>'complete' from results where k='catalogue'),'true','AC-006 catalogue chunk imports existing unit and zero-cost tag');
select is((select code from stock_items where code='000-SYN'),'000-SYN','AC-006 item code preserves leading zeros');
select is(jsonb_array_length(om_material_config()->'categories'),1,'AC-005 categories appear in configuration');
select is(jsonb_array_length(om_material_config()->'owner_warehouses'),1,'AC-005 owner warehouses appear in configuration');
select is(jsonb_array_length(om_material_config()->'zero_cost_tags'),1,'AC-005 v2.2 configuration lists live same-org zero-cost tags');
select is(om_material_import('synthetic-catalogue',2,
 jsonb_build_object('kind','catalogue','project_id','30110000-0000-0000-0000-0000000001d1','entities',jsonb_build_array(
 jsonb_build_object('entity_key','catalogue-category','hash','cat-v2','type','category','code','SYN-CAT','name','Conflicting name'))),true)->>'complete','false','AC-006 catalogue conflict does not overwrite existing names');
select is((select name from stock_material_categories where code='SYN-CAT'),'Synthetic category','AC-006 catalogue name remains intact after refusal');
select is(om_material_import('synthetic-opening',2,
 jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.payload(),'{entities,0,entity_key}','"section-south"'),'{entities,0,location_name}','"South"'),'{entities,0,section_code}','"S"'),'{entities,0,lines,0,entity_key}','"line-south-cable"'),true)->>'complete','true','AC-006 a second location creates a distinct section on the same work order');
select is((select count(*) from work_order_sections where work_order_id='30110000-0000-0000-0000-000000001401'),2::bigint,'AC-006 locations sharing an order remain separate');
select is((select count(*) from work_orders where client_po_number='OMI-ORDER'),1::bigint,'AC-006 material import reuses the one existing order');
select pg_temp.act_as('30110000-0000-0000-0000-0000000001a2');
select throws_ok($$select om_material_import('denied',2,pg_temp.payload(),true)$$,'42501','Admin required','AC-005 member cannot import');
select pg_temp.act_as('30110000-0000-0000-0000-0000000001b1');
select throws_ok($$select om_material_import('foreign',2,pg_temp.payload(),true)$$,'42501','Project unavailable','AC-005 foreign Admin cannot import into project');
select is((select count(*) from owner_material_openings),0::bigint,'AC-005 foreign Admin cannot see opening');
select set_config('request.jwt.claims','{"sub":"30110000-0000-0000-0000-0000000001a1","role":"authenticated","client_id":"pmo-cli"}',true);
select set_config('request.method','POST',true),set_config('request.headers','{}',true);
select set_config('request.path','/rpc/import_work_orders',true);
select lives_ok('select api_client_request_guard()','AC-005 Admin CLI can prepare work orders');
select set_config('request.path','/rpc/om_material_config',true);
select lives_ok('select api_client_request_guard()','AC-005 Admin CLI can resolve material configuration');
select set_config('request.path','/rpc/om_material_import',true);
select lives_ok('select api_client_request_guard()','AC-005 Admin CLI can import opening stages');
select set_config('request.method','GET',true),set_config('request.path','/work_orders',true);
select lives_ok('select api_client_request_guard()','AC-005 Admin CLI can match existing work orders');
select set_config('request.method','PATCH',true);
select throws_ok('select api_client_request_guard()','42501',null,'AC-005 material CLI does not gain work-order direct writes');
select set_config('request.method','POST',true),set_config('request.path','/rpc/om_material_set_scale',true);
select lives_ok('select api_client_request_guard()','AC-005 v2.2 Admin CLI may configure reconciliation scale');
select set_config('request.path','/rpc/om_material_set_reconciliation',true);
select throws_ok('select api_client_request_guard()','42501',null,'AC-005 sibling material writers are not exposed to CLI');
select set_config('request.jwt.claims','{"sub":"30110000-0000-0000-0000-0000000001a2","role":"authenticated","client_id":"pmo-cli"}',true);
select set_config('request.path','/rpc/om_material_import',true);
select throws_ok('select api_client_request_guard()','42501',null,'AC-005 member CLI cannot import opening stages');
select set_config('request.path','/rpc/om_material_set_scale',true);
select throws_ok('select api_client_request_guard()','42501',null,'AC-005 v2.2 member CLI cannot configure reconciliation scale');
-- Projected-state and matching contracts use made-up catalogue data only.
select pg_temp.act_as('30110000-0000-0000-0000-0000000001a1');
create function pg_temp.catalogue(p_entities jsonb) returns jsonb language sql as $$
 select jsonb_build_object('kind','catalogue','project_id','30110000-0000-0000-0000-0000000001d1','entities',p_entities);
$$;
insert into results values('units',om_material_import('matching',2,pg_temp.catalogue('[
 {"entity_key":"item-alpha","hash":"a1","type":"item","code":"A-1X","name":"Synthetic alpha","unit":" ea ","zero_cost_tag_id":"30110000-0000-0000-0000-000000005001"},
 {"entity_key":"unit-each","hash":"u1","type":"unit","code":" ea ","name":"Each","whole_only":false}]'),true));
select is((select v->>'complete' from results where k='units'),'true','AC-006 unit dependency is processed before item');
select is((select code from stock_units where upper(btrim(code))='EA'),'EA','AC-006 unit code is normalized');
select is((select code from stock_items where code='A-1X'),'A-1X','AC-006 non-numeric item code matches the column contract');
insert into results values('name-note',om_material_import('matching',2,pg_temp.catalogue('[
 {"entity_key":"item-cable","hash":"n1","type":"item","code":" CBL ","name":"Different source description","unit":" m ","zero_cost_tag_id":"30110000-0000-0000-0000-000000005001"}]'),true));
select is((select v->'results'->0->>'status' from results where k='name-note'),'skip','AC-006 existing item name difference skips');
select ok(length((select v->'results'->0->>'note' from results where k='name-note'))>0,'AC-006 retained item name is reported');
select is((select name from stock_items where code='CBL'),'Cable','AC-006 source description never overwrites an existing name');
insert into results values('unit-conflict',om_material_import('matching',2,pg_temp.catalogue('[
 {"entity_key":"bad-unit-item","hash":"b1","type":"item","code":"CBL","name":"Cable","unit":"EA","zero_cost_tag_id":"30110000-0000-0000-0000-000000005001"},
 {"entity_key":"good-item","hash":"g1","type":"item","code":"GOOD","name":"Good item","unit":"M","zero_cost_tag_id":"30110000-0000-0000-0000-000000005001"}]'),true));
select is((select count(*) from stock_items where code='GOOD'),1::bigint,'AC-006 one refused catalogue item does not discard another item');
select ok((select v->'results'->0->>'reason' like '%unit%EA%' from results where k='unit-conflict'),'AC-006 refusal names the offending unit value');
select is((select v->'results'->0->>'reason_code' from results where k='unit-conflict'),'material-conflict','AC-006 refusal retains a machine code');
insert into results values('top-up',om_material_import('synthetic-opening',2,jsonb_set(pg_temp.payload('top-up','451','5','1','4'),'{entities,0,owner_cost_code}','"OTHER"'),true));
select is((select owner_cost_code from work_order_sections where name='North'),'SYNTHETIC','AC-006 existing nonempty owner cost code is kept');
select ok(exists(select 1 from jsonb_array_elements((select v->'results' from results where k='top-up')) r where length(r->>'note')>0),'AC-006 kept section cost code produces a note');
create function pg_temp.projected() returns jsonb language sql as $$
 select jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.payload('projected','2','2','1','1'),'{entities,0,entity_key}','"projected-section"'),'{entities,0,location_name}','"Projected"'),'{entities,0,section_code}','"P"'),'{entities,0,lines,0,item_code}','"FRESH"'),'{entities,0,lines,0,unit}','"BX"') ||
 jsonb_build_object('catalogue_entities',jsonb_build_array(
 jsonb_build_object('entity_key','projected-unit','hash','pu1','type','unit','code','BX','name','Box','whole_only',false),
 jsonb_build_object('entity_key','projected-item','hash','pi1','type','item','code','FRESH','name','Fresh item','unit','BX','zero_cost_tag_id','30110000-0000-0000-0000-000000005001')),
 'reconciliation_scale','[{"name":"Prepared","position":1,"percentage":"20"},{"name":"Checked","position":2,"percentage":"40"},{"name":"Submitted","position":3,"percentage":"60"},{"name":"Agreed","position":4,"percentage":"80"},{"name":"Closed","position":5,"percentage":"100"}]'::jsonb);
$$;
insert into results values('projected',om_material_import('projected',2,pg_temp.projected(),false));
select is((select v->>'complete' from results where k='projected'),'true','AC-006 preview validates projected unit and item together');
select is((select count(*) from stock_items where code='FRESH'),0::bigint,'AC-006 projected preview leaves no item');
select is((select count(*) from stock_units where code='BX'),0::bigint,'AC-006 projected preview leaves no unit');
select is((select count(*) from work_order_sections where name='Projected'),0::bigint,'AC-006 projected preview leaves no section');
insert into results values('projected-confirm',om_material_import('projected',2,pg_temp.projected(),true));
select is((select v->>'complete' from results where k='projected-confirm'),'true','AC-006 confirm accepts identical projected dependencies');
insert into results values('mixed-lines',om_material_import('projected',2,jsonb_set(pg_temp.projected(),'{entities,0,hash}','"mixed-lines"') || jsonb_build_object('entities',jsonb_build_array(
 (pg_temp.projected()->'entities'->0) || jsonb_build_object('hash','mixed-lines','lines',jsonb_build_array(
 jsonb_set(pg_temp.projected()->'entities'->0->'lines'->0,'{entity_key}','"good-projected-line"'),
 (pg_temp.payload()->'entities'->0->'lines'->0)||jsonb_build_object('entity_key','wrong-unit-line','unit','EA'))))),true));
select is((select v->>'complete' from results where k='mixed-lines'),'false','AC-006 unit disagreement marks a partial section');
select is((select count(*) from owner_material_openings o join work_order_section_material_plan p on p.id=o.section_material_plan_id join stock_items i on i.id=p.item_id where i.code='FRESH'),1::bigint,'AC-006 valid line survives another line unit disagreement');
select is((select r->>'entity_key' from results t,jsonb_array_elements(t.v->'results') r where t.k='mixed-lines' and r->>'status'='refused'),'wrong-unit-line','AC-006 unit disagreement is returned at line identity');
insert into results values('projected-scale',om_material_import('scale-preview',2,
 jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.projected(),'{entities,0,location_name}','"Scale preview"'),'{entities,0,section_code}','"PS"'),'{entities,0,reconciliation_step}','"Reviewed"'),'{reconciliation_scale}',
 '[{"name":"Prepared","position":1,"percentage":"20"},{"name":"Reviewed","position":2,"percentage":"100"}]'),false));
select is((select v->>'complete' from results where k='projected-scale'),'true','AC-006 preview validates the projected reconciliation scale');
select is((select count(*) from owner_material_reconciliation_steps where name='Reviewed'),0::bigint,'AC-006 projected scale is not persisted by preview');
select is(om_material_import('scale-confirm',2,jsonb_set(pg_temp.projected(),'{reconciliation_scale}',
 '[{"name":"Prepared","position":1,"percentage":"20"},{"name":"Reviewed","position":2,"percentage":"100"}]'),true)->'results'->0->>'reason_code','material-conflict','AC-006 confirm requires the projected scale to be configured first');
select ok(not exists(select 1 from results t,jsonb_array_elements(t.v->'results') r where not(r ? 'reason_code' and r ? 'reason')),'AC-006 every result has reason text and machine-code fields');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into work_orders(id,org_id,project_id,title,client_po_number,status,order_value,tax_treatment,tax_amount) values
 ('30110000-0000-0000-0000-000000001403','30110000-0000-0000-0000-00000000010a','30110000-0000-0000-0000-0000000001d1','Closed synthetic order','CLOSED-ORDER','Closed',0,'exclusive',0);
set local role authenticated;
select pg_temp.act_as('30110000-0000-0000-0000-0000000001a1');
insert into results values('closed',om_material_import('closed',2,jsonb_set(pg_temp.payload(),'{entities,0,owner_order_number}','"CLOSED-ORDER"'),false));
select is((select v->'results'->0->>'reason_code' from results where k='closed'),'material-conflict','AC-006 Closed work orders remain refused');
select ok((select v->'results'->0->>'reason' like '%status%Closed%' from results where k='closed'),'AC-006 state refusal identifies the state value');
insert into results values('invalid-code',om_material_import('invalid-code',2,
 jsonb_set(jsonb_set(pg_temp.payload('invalid-code'),'{entities,0,location_name}','"New location"'),'{entities,0,section_code}','"SECTION_CODE_OVER_LIMIT"'),false));
select ok((select v->'results'->0->>'reason' like '%section_code%SECTION_CODE_OVER_LIMIT%' from results where k='invalid-code'),'AC-006 code refusal names the code field and value');
insert into results values('bad-preview',om_material_import('synthetic-opening',2,
 jsonb_set(pg_temp.payload('invalid-closing'),'{entities,0,lines,0,expected,closing}','"Check"'),false));
insert into results values('bad-confirm',om_material_import('synthetic-opening',2,
 jsonb_set(pg_temp.payload('invalid-closing'),'{entities,0,lines,0,expected,closing}','"Check"'),true));
select ok((select v->'results'->0->>'reason' like '%expected.closing%Check%' from results where k='bad-preview'),'AC-006 preview names an invalid closing value');
select is((select v->'results'->0->>'reason' from results where k='bad-preview'),(select v->'results'->0->>'reason' from results where k='bad-confirm'),'AC-006 confirm uses the same human refusal as preview');
select throws_ok($$select om_material_catalogue_entity('{}')$$,'42501',null,'AC-005 catalogue helper is not a public write path');
insert into results values('structured-evidence',om_material_import('synthetic-opening',2,
 jsonb_set(pg_temp.payload('structured-evidence'),'{entities,0,lines,0,evidence,reference}','{"text":"Synthetic reference"}'),false));
select is((select v->>'complete' from results where k='structured-evidence'),'false','AC-006 evidence values use scalar text');
insert into results values('numeric-evidence',om_material_import('synthetic-opening',2,
 jsonb_set(pg_temp.payload('numeric-evidence'),'{entities,0,lines,0,evidence,reference}','7'),false));
select is((select v->>'complete' from results where k='numeric-evidence'),'false','AC-006 evidence quantities are supplied as text');
insert into results values('large-value',om_material_import('synthetic-opening',2,
 jsonb_set(pg_temp.payload('large-value'),'{entities,0,lines,0,evidence,reference}',to_jsonb(repeat('X',4097))),false));
select is((select v->>'complete' from results where k='large-value'),'false','AC-006 evidence value is bounded at 4096 bytes');
select ok((select v->'results'->0->>'reason' like '%evidence.reference%' from results where k='large-value'),'AC-006 evidence refusal identifies its field');
select is(om_material_import('synthetic-opening',2,
 jsonb_set(pg_temp.payload('boundary-value'),'{entities,0,lines,0,evidence,reference}',to_jsonb(repeat('X',4096))),false)->>'complete','true','AC-006 bounded scalar evidence remains accepted');
select is(om_material_import('synthetic-opening',2,
 jsonb_set(pg_temp.payload('multibyte-value'),'{entities,0,lines,0,evidence,reference}',to_jsonb(repeat('界',1366))),false)->>'complete','false','AC-006 evidence bounds count UTF-8 bytes');
select * from finish();
rollback;

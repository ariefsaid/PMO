set search_path = public, extensions;
begin;
select no_plan();
insert into organizations (id, name) values ('a8700000-0000-0000-0000-000000000001','Stock A'), ('a8700000-0000-0000-0000-000000000002','Stock B');
insert into auth.users (id, email) values ('a8700000-0000-0000-0000-0000000000a1','a870-admin@example.test'), ('a8700000-0000-0000-0000-0000000000a2','a870-admin2@example.test'), ('a8700000-0000-0000-0000-0000000000e1','a870-eng@example.test'), ('a8700000-0000-0000-0000-0000000000d1','a870-disabled@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a8700000-0000-0000-0000-0000000000a1','a8700000-0000-0000-0000-000000000001','A','a870-admin@example.test','Admin','active'),
 ('a8700000-0000-0000-0000-0000000000a2','a8700000-0000-0000-0000-000000000002','B','a870-admin2@example.test','Admin','active'),
 ('a8700000-0000-0000-0000-0000000000e1','a8700000-0000-0000-0000-000000000001','E','a870-eng@example.test','Engineer','active'),
 ('a8700000-0000-0000-0000-0000000000d1','a8700000-0000-0000-0000-000000000001','D','a870-disabled@example.test','Admin','disabled');
insert into external_org_bindings (id, org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a8700000-0000-0000-0000-0000000000b1','a8700000-0000-0000-0000-000000000001','odoo','https://erp.example.test','test','active','{"odoo_company_id":1}',now()),
 ('a8700000-0000-0000-0000-0000000000b2','a8700000-0000-0000-0000-000000000002','erpnext','https://erp.example.test','test2','active','{}',now());
insert into stock_units (id, org_id, code, name) values ('a8700000-0000-0000-0000-000000000010','a8700000-0000-0000-0000-000000000001','EA','Each');
insert into stock_items (id, org_id, code, name, unit_id, archived_at) values
 ('a8700000-0000-0000-0000-000000000011','a8700000-0000-0000-0000-000000000001','I1','Item','a8700000-0000-0000-0000-000000000010',null),
 ('a8700000-0000-0000-0000-000000000012','a8700000-0000-0000-0000-000000000001','I2','Archived','a8700000-0000-0000-0000-000000000010',now());
insert into stock_warehouses (id,org_id,code,name,kind,archived_at) values
 ('a8700000-0000-0000-0000-000000000021','a8700000-0000-0000-0000-000000000001','W1','Warehouse','central',null),
 ('a8700000-0000-0000-0000-000000000022','a8700000-0000-0000-0000-000000000001','W2','Archived','central',now());
insert into erp_connect_runs (id,org_id,binding_id,external_tier,state) values
 ('a8700000-0000-0000-0000-000000000030','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','ready'),
 ('a8700000-0000-0000-0000-000000000031','a8700000-0000-0000-0000-000000000002','a8700000-0000-0000-0000-0000000000b2','erpnext','ready');
select lives_ok($$insert into erp_connect_staged (run_id,org_id,kind,external_id,row) values
 ('a8700000-0000-0000-0000-000000000030','a8700000-0000-0000-0000-000000000001','stock_item','101','{"externalId":"101","active":true}'),
 ('a8700000-0000-0000-0000-000000000030','a8700000-0000-0000-0000-000000000001','stock_warehouse','201','{"externalId":"201","active":true}'),
 ('a8700000-0000-0000-0000-000000000030','a8700000-0000-0000-0000-000000000002','stock_item','999','{"externalId":"999","active":true}')$$,'AC-OSP-001 stock candidates can be staged for a run');
insert into erp_connect_proposals (id,org_id,binding_id,external_tier,run_id,kind,outcome,identity,pmo_ids,external_ids) values
 ('a8700000-0000-0000-0000-000000000041','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030','stock_item','link','item',array['a8700000-0000-0000-0000-000000000011'],array['101']),
 ('a8700000-0000-0000-0000-000000000042','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030','stock_warehouse','link','warehouse',array['a8700000-0000-0000-0000-000000000021'],array['201']),
 ('a8700000-0000-0000-0000-000000000043','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030','stock_item','link','unstaged',array['a8700000-0000-0000-0000-000000000011'],array['999']),
 ('a8700000-0000-0000-0000-000000000044','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030','stock_item','link','archived-item',array['a8700000-0000-0000-0000-000000000012'],array['101']),
 ('a8700000-0000-0000-0000-000000000045','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030','stock_warehouse','link','archived-warehouse',array['a8700000-0000-0000-0000-000000000022'],array['201']),
 ('a8700000-0000-0000-0000-000000000046','a8700000-0000-0000-0000-000000000002','a8700000-0000-0000-0000-0000000000b2','erpnext','a8700000-0000-0000-0000-000000000031','stock_item','link','tier',array['a8700000-0000-0000-0000-000000000011'],array['101']);
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select public.accept_connect_proposals('odoo','stock_item')$$,'42501',null,'AC-OSP-006 non Admin refused');
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_ok($$select public.accept_connect_proposals('odoo','stock_item')$$,'42501',null,'AC-OSP-006 inactive Admin refused');
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.accept_connect_proposals('odoo','stock_item',array['a8700000-0000-0000-0000-000000000041'::uuid])$$,'P0001','no active connection for this ERP','AC-OSP-006 other organization cannot accept');
select public.accept_connect_proposals('erpnext','stock_item');
reset role;
select is((select reason_text from erp_connect_proposals where identity='tier'),'Stock links require an active Odoo connection','AC-OSP-006 wrong tier refused');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.accept_connect_proposals('odoo','stock_item',array['a8700000-0000-0000-0000-000000000043'::uuid,'a8700000-0000-0000-0000-000000000044'::uuid]);
select public.accept_connect_proposals('odoo','stock_warehouse',array['a8700000-0000-0000-0000-000000000045'::uuid]);
reset role;
select is((select reason_text from erp_connect_proposals where identity='unstaged'),'Stock candidate is not staged for this run','AC-OSP-006 unstaged candidate refused');
select is((select reason_text from erp_connect_proposals where identity='archived-item'),'Stock item is unavailable','AC-OSP-006 archived item refused');
select is((select reason_text from erp_connect_proposals where identity='archived-warehouse'),'Stock warehouse is unavailable','AC-OSP-006 archived warehouse refused');
update external_org_bindings set activated_at=null where id='a8700000-0000-0000-0000-0000000000b1';
set local role authenticated;
select public.accept_connect_proposals('odoo','stock_item',array['a8700000-0000-0000-0000-000000000041'::uuid]);
reset role;
select is((select reason_text from erp_connect_proposals where identity='item'),'Stock links require an active Odoo connection','AC-OSP-006 unactivated binding refused');
update external_org_bindings set activated_at=now() where id='a8700000-0000-0000-0000-0000000000b1';
update external_org_bindings set config='{}' where id='a8700000-0000-0000-0000-0000000000b1';
set local role authenticated;
select public.accept_connect_proposals('odoo','stock_item',array['a8700000-0000-0000-0000-000000000041'::uuid]);
reset role;
select is((select reason_text from erp_connect_proposals where identity='item'),'Choose an Odoo company before linking stock','AC-OSP-006 missing company refused');
select is((select count(*)::int from external_refs where org_id in ('a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-000000000002') and domain in ('stock_items','stock_warehouses')),0,'AC-OSP-006 refusals create no links');
update external_org_bindings set config='{"odoo_company_id":1}' where id='a8700000-0000-0000-0000-0000000000b1';
set local role authenticated;
select public.accept_connect_proposals('odoo','stock_item',array['a8700000-0000-0000-0000-000000000041'::uuid]);
select public.accept_connect_proposals('odoo','stock_warehouse',array['a8700000-0000-0000-0000-000000000042'::uuid]);
select lives_ok($$select public.accept_connect_proposals('odoo','stock_item',array['a8700000-0000-0000-0000-000000000041'::uuid])$$,'AC-OSP-001 replay is harmless');
reset role;
select results_eq($$select domain,pmo_record_id,external_record_id from external_refs where org_id='a8700000-0000-0000-0000-000000000001' and domain like 'stock_%' order by domain$$,
 $$values ('stock_items'::text,'a8700000-0000-0000-0000-000000000011'::text,'101'::text),('stock_warehouses'::text,'a8700000-0000-0000-0000-000000000021'::text,'201'::text)$$,'AC-OSP-001 Admin links the staged stock item and warehouse exactly once');
select * from finish();
rollback;

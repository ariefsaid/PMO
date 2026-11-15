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

insert into stock_items (id,org_id,code,name,unit_id) values
 ('a8700000-0000-0000-0000-000000000013','a8700000-0000-0000-0000-000000000001','I3','Three','a8700000-0000-0000-0000-000000000010'),
 ('a8700000-0000-0000-0000-000000000014','a8700000-0000-0000-0000-000000000001','I4','Four','a8700000-0000-0000-0000-000000000010'),
 ('a8700000-0000-0000-0000-000000000015','a8700000-0000-0000-0000-000000000001','I5','Five','a8700000-0000-0000-0000-000000000010');
insert into stock_warehouses (id,org_id,code,name,kind) values
 ('a8700000-0000-0000-0000-000000000023','a8700000-0000-0000-0000-000000000001','W3','Three','central');
insert into erp_connect_staged (run_id,org_id,kind,external_id,row)
select 'a8700000-0000-0000-0000-000000000030','a8700000-0000-0000-0000-000000000001', kind, ext, jsonb_build_object('externalId',ext,'active',true)
from (values ('stock_item','102'),('stock_item','103'),('stock_item','104'),('stock_warehouse','202')) x(kind,ext);
insert into erp_connect_proposals (id,org_id,binding_id,external_tier,run_id,kind,outcome,identity,pmo_ids,external_ids)
select id::uuid,'a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030',kind,'link',ident,array[pmo],array[ext]
from (values
 ('a8700000-0000-0000-0000-000000000051','stock_item','item-external','a8700000-0000-0000-0000-000000000013','101'),
 ('a8700000-0000-0000-0000-000000000052','stock_item','item-pmo','a8700000-0000-0000-0000-000000000011','102'),
 ('a8700000-0000-0000-0000-000000000053','stock_warehouse','warehouse-external','a8700000-0000-0000-0000-000000000023','201'),
 ('a8700000-0000-0000-0000-000000000054','stock_warehouse','warehouse-pmo','a8700000-0000-0000-0000-000000000021','202'),
 ('a8700000-0000-0000-0000-000000000055','stock_item','clean-one','a8700000-0000-0000-0000-000000000014','103'),
 ('a8700000-0000-0000-0000-000000000056','stock_item','clean-two','a8700000-0000-0000-0000-000000000015','104')
) x(id,kind,ident,pmo,ext);
set local role authenticated;
select set_config('a870.batch',public.accept_connect_proposals('odoo','stock_item',array['a8700000-0000-0000-0000-000000000051'::uuid,'a8700000-0000-0000-0000-000000000055'::uuid,'a8700000-0000-0000-0000-000000000056'::uuid])::text,true);
select public.accept_connect_proposals('odoo','stock_item',array['a8700000-0000-0000-0000-000000000052'::uuid]);
select public.accept_connect_proposals('odoo','stock_warehouse',array['a8700000-0000-0000-0000-000000000053'::uuid,'a8700000-0000-0000-0000-000000000054'::uuid]);
reset role;
select is(current_setting('a870.batch')::jsonb #>> '{counts,stock_item,link}','2','AC-OSP-001 accept all links both uncontested rows');
select is(current_setting('a870.batch')::jsonb #>> '{counts,stock_item,left_open}','1','AC-OSP-001 accept all reports the contested row');
select is((select count(*)::int from erp_connect_proposals where identity in ('item-external','item-pmo','warehouse-external','warehouse-pmo') and outcome='review' and state='open' and reason_text like 'Stock record is already linked%'),4,'AC-OSP-006 both directions of each domain remain in review with named refusal');
select is((select count(*)::int from erp_connect_proposals where identity in ('item-external','warehouse-external') and reason_text like '%ERP record%'),2,'AC-OSP-006 ERP side identified');
select is((select count(*)::int from erp_connect_proposals where identity in ('item-pmo','warehouse-pmo') and reason_text like '%PMO record%'),2,'AC-OSP-006 PMO side identified');
select is((select count(*)::int from external_refs where org_id='a8700000-0000-0000-0000-000000000001' and domain like 'stock_%'),4,'AC-OSP-006 contested accepts leave original links unchanged');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select public.unlink_connect_match('a8700000-0000-0000-0000-000000000041')$$,'42501',null,'AC-OSP-006 non Admin cannot unlink');
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.unlink_connect_match('a8700000-0000-0000-0000-000000000041')$$,'P0002','link not found','AC-OSP-006 other organization cannot unlink');
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(cardinality(public.list_unlinkable_connect_matches(array['a8700000-0000-0000-0000-000000000041'::uuid,'a8700000-0000-0000-0000-000000000042'::uuid])),2,'AC-OSP-006 both stock links are offered for unlink');
reset role;
-- A live inventory command whose document names the item or warehouse keeps the link in use; the command guard is stepped past (the fixture is not a post).
alter table public.external_command_outbox disable trigger external_command_outbox_zz_stock_command;
insert into stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by) values ('a8700000-0000-0000-0000-000000000051','a8700000-0000-0000-0000-000000000001','T51','transfer','a8700000-0000-0000-0000-000000000021','a8700000-0000-0000-0000-000000000022',current_date,'a8700000-0000-0000-0000-0000000000a1');
insert into stock_document_lines (org_id,document_id,line_no,item_id,quantity) values ('a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-000000000051',1,'a8700000-0000-0000-0000-000000000011',1);
insert into external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
values ('a8700000-0000-0000-0000-000000000001','inventory','a8700000-0000-0000-0000-000000000051','stock:a8700000-0000-0000-0000-000000000051','odoo','create','held','a8700000-0000-0000-0000-0000000000a1','{}');
select ok(public.connect_link_in_use('a8700000-0000-0000-0000-000000000001','stock_items','a8700000-0000-0000-0000-000000000011'),'AC-OSP-006 a held command keeps its stock item link in use');
select ok(public.connect_link_in_use('a8700000-0000-0000-0000-000000000001','stock_warehouses','a8700000-0000-0000-0000-000000000021'),'AC-OSP-006 a held command keeps its warehouse link in use');
select ok(not public.connect_link_in_use('a8700000-0000-0000-0000-000000000001','stock_items','a8700000-0000-0000-0000-000000000012'),'AC-OSP-006 an item no command names is not in use');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.unlink_connect_match('a8700000-0000-0000-0000-000000000041')$$,'P0001','link in use','AC-OSP-006 a stock item link in use cannot be unlinked');
select is(cardinality(public.list_unlinkable_connect_matches(array['a8700000-0000-0000-0000-000000000041'::uuid,'a8700000-0000-0000-0000-000000000042'::uuid])),0,'AC-OSP-006 links in use are not offered for unlink');
reset role;
update external_command_outbox set state='confirmed' where pmo_record_id='a8700000-0000-0000-0000-000000000051';
select ok(not public.connect_link_in_use('a8700000-0000-0000-0000-000000000001','stock_items','a8700000-0000-0000-0000-000000000011'),'AC-OSP-006 a confirmed command no longer holds the link');
update external_command_outbox set state='failed' where pmo_record_id='a8700000-0000-0000-0000-000000000051';
select ok(not public.connect_link_in_use('a8700000-0000-0000-0000-000000000001','stock_warehouses','a8700000-0000-0000-0000-000000000021'),'AC-OSP-006 a plain failed command does not hold the link');
-- A released hold (held -> failed) is a durable fact: the transfer may exist in Odoo, so both links stay in use, also after a later failure.
update external_command_outbox set state='held' where pmo_record_id='a8700000-0000-0000-0000-000000000051';
update external_command_outbox set state='failed' where pmo_record_id='a8700000-0000-0000-0000-000000000051';
select ok(public.connect_link_in_use('a8700000-0000-0000-0000-000000000001','stock_items','a8700000-0000-0000-0000-000000000011'),'AC-OSP-006 a released hold keeps its stock item link in use');
select ok(public.connect_link_in_use('a8700000-0000-0000-0000-000000000001','stock_warehouses','a8700000-0000-0000-0000-000000000021'),'AC-OSP-006 a released hold keeps its warehouse link in use');
update external_command_outbox set state='pending' where pmo_record_id='a8700000-0000-0000-0000-000000000051';
update external_command_outbox set state='failed' where pmo_record_id='a8700000-0000-0000-0000-000000000051';
select ok(public.connect_link_in_use('a8700000-0000-0000-0000-000000000001','stock_items','a8700000-0000-0000-0000-000000000011'),'AC-OSP-006 a released then failed again command keeps its stock item link in use');
select ok(public.connect_link_in_use('a8700000-0000-0000-0000-000000000001','stock_warehouses','a8700000-0000-0000-0000-000000000021'),'AC-OSP-006 a released then failed again command keeps its warehouse link in use');
delete from external_command_outbox where pmo_record_id='a8700000-0000-0000-0000-000000000051';
delete from stock_document_lines where document_id='a8700000-0000-0000-0000-000000000051';
delete from stock_documents where id='a8700000-0000-0000-0000-000000000051';
alter table public.external_command_outbox enable trigger external_command_outbox_zz_stock_command;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.unlink_connect_match('a8700000-0000-0000-0000-000000000041')$$,'AC-OSP-006 Admin unlinks stock item');
reset role;
select is((select count(*)::int from external_refs where org_id='a8700000-0000-0000-0000-000000000001' and domain like 'stock_%'),3,'AC-OSP-006 unlink removes only one row');
set local role authenticated;
select lives_ok($$select public.unlink_connect_match('a8700000-0000-0000-0000-000000000042')$$,'AC-OSP-006 Admin unlinks stock warehouse');
reset role;
select is((select count(*)::int from external_refs where org_id='a8700000-0000-0000-0000-000000000001' and domain like 'stock_%'),2,'AC-OSP-006 warehouse unlink removes only one row');
insert into external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values ('a8700000-0000-0000-0000-000000000001','stock_warehouses','a8700000-0000-0000-0000-000000000023','odoo','201');
select public.discard_odoo_mirror('a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from external_refs where org_id='a8700000-0000-0000-0000-000000000001' and domain like 'stock_%'),0,'AC-OSP-006 Odoo discard clears stock item and warehouse links');


-- Review choices use only candidates staged for the proposal's run.
update external_org_bindings set config='{"odoo_company_id":1}' where id='a8700000-0000-0000-0000-0000000000b1';
insert into stock_items (id,org_id,code,name,unit_id) values
 ('a8700000-0000-0000-0000-000000000016','a8700000-0000-0000-0000-000000000001','I6','Six','a8700000-0000-0000-0000-000000000010'),
 ('a8700000-0000-0000-0000-000000000017','a8700000-0000-0000-0000-000000000001','I7','Seven','a8700000-0000-0000-0000-000000000010'),
 ('a8700000-0000-0000-0000-000000000018','a8700000-0000-0000-0000-000000000001','I8','Eight','a8700000-0000-0000-0000-000000000010');
insert into stock_warehouses (id,org_id,code,name,kind) values
 ('a8700000-0000-0000-0000-000000000024','a8700000-0000-0000-0000-000000000001','W4','Four','central');
insert into erp_connect_staged (run_id,org_id,kind,external_id,row)
select 'a8700000-0000-0000-0000-000000000030','a8700000-0000-0000-0000-000000000001',kind,ext,jsonb_build_object('externalId',ext,'active',true)
from (values ('stock_item','110'),('stock_item','111'),('stock_warehouse','210')) x(kind,ext);
insert into erp_connect_proposals (id,org_id,binding_id,external_tier,run_id,kind,outcome,identity,pmo_ids,external_ids,reason) values
 ('a8700000-0000-0000-0000-000000000061','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030','stock_item','review','review-ambiguous',array['a8700000-0000-0000-0000-000000000016','a8700000-0000-0000-0000-000000000017'],array['110','111','999','210'],'ambiguous'),
 ('a8700000-0000-0000-0000-000000000062','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030','stock_warehouse','review','review-unmatched',array['a8700000-0000-0000-0000-000000000024'],array[]::text[],'ambiguous'),
 ('a8700000-0000-0000-0000-000000000063','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030','stock_item','review','review-rejected',array['a8700000-0000-0000-0000-000000000018'],array['101'],'ambiguous'),
 ('a8700000-0000-0000-0000-000000000064','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030','stock_item','review','review-dismiss',array['a8700000-0000-0000-0000-000000000017'],array[]::text[],'ambiguous'),
 ('a8700000-0000-0000-0000-000000000065','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','a8700000-0000-0000-0000-000000000030','stock_item','review','review-archived',array['a8700000-0000-0000-0000-000000000012'],array['110'],'ambiguous');
insert into external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values ('a8700000-0000-0000-0000-000000000001','stock_items','a8700000-0000-0000-0000-000000000011','odoo','101');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000016","externalId":"110"}')$$,'42501',null,'AC-OSP-006 non Admin cannot resolve stock review');
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000016","externalId":"110"}')$$,'42501',null,'AC-OSP-006 inactive Admin cannot resolve stock review');
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000016","externalId":"110"}')$$,'P0002','review not found','AC-OSP-006 foreign Admin cannot resolve stock review');
set local request.jwt.claims = '{"sub":"a8700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000018","externalId":"110"}')$$,'22023','That record is not available for this kind','AC-OSP-006 PMO choice must belong to the proposal');
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000016","externalId":"999"}')$$,'22023','That record is not available for this kind','AC-OSP-006 candidate from another organization refused');
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000016","externalId":"210"}')$$,'22023','That record is not available for this kind','AC-OSP-006 candidate of another stock kind refused');
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000065','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000012","externalId":"110"}')$$,'P0001','Stock item is unavailable','AC-OSP-006 archived master cannot be linked from review');
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000063','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000018","externalId":"101"}')$$,'P0001','Stock record is already linked: the ERP record has another PMO record','AC-OSP-006 competing candidate has named refusal');
reset role;
update external_org_bindings set config='{}' where id='a8700000-0000-0000-0000-0000000000b1';
set local role authenticated;
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000016","externalId":"110"}')$$,'P0001','Choose an Odoo company before linking stock','AC-OSP-006 review requires chosen company');
reset role;
update external_org_bindings set config='{"odoo_company_id":1}',activated_at=null where id='a8700000-0000-0000-0000-0000000000b1';
set local role authenticated;
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000016","externalId":"110"}')$$,'P0001','Stock links require an active Odoo connection','AC-OSP-006 review requires activated binding');
reset role;
update external_org_bindings set activated_at=now() where id='a8700000-0000-0000-0000-0000000000b1';
insert into erp_connect_runs(id,org_id,binding_id,external_tier,state,started_at) values ('a8700000-0000-0000-0000-000000000099','a8700000-0000-0000-0000-000000000001','a8700000-0000-0000-0000-0000000000b1','odoo','ready',now()+interval '1 second');
set local role authenticated;
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000016","externalId":"110"}')$$,'P0001','Stock candidate is not staged for this run','AC-OSP-006 review requires latest ready run');
reset role;
delete from erp_connect_runs where id='a8700000-0000-0000-0000-000000000099';
insert into external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values ('a8700000-0000-0000-0000-000000000001','stock_items','a8700000-0000-0000-0000-000000000018','odoo','102');
set local role authenticated;
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000063','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000018","externalId":"110"}')$$,'P0001','Stock record is already linked: the PMO record has another ERP record','AC-OSP-006 competing PMO record has named refusal');
reset role;
delete from external_refs where org_id='a8700000-0000-0000-0000-000000000001' and domain='stock_items' and pmo_record_id='a8700000-0000-0000-0000-000000000018';
set local role authenticated;
select lives_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000016","externalId":"110"}')$$,'AC-OSP-001 Admin resolves ambiguous item review');
select lives_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000062','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000024","externalId":"210"}')$$,'AC-OSP-001 Admin resolves unmatched warehouse review');
select throws_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000061','{"action":"link","pmoId":"a8700000-0000-0000-0000-000000000016","externalId":"110"}')$$,'P0002','review not found','AC-OSP-006 closed review cannot be resolved twice');
select lives_ok($$select public.decide_connect_review('a8700000-0000-0000-0000-000000000064','{"action":"dismiss"}')$$,'AC-OSP-001 Admin dismisses stock review');
reset role;
select is((select count(*)::int from external_refs where org_id='a8700000-0000-0000-0000-000000000001' and ((domain='stock_items' and pmo_record_id='a8700000-0000-0000-0000-000000000016' and external_record_id='110') or (domain='stock_warehouses' and pmo_record_id='a8700000-0000-0000-0000-000000000024' and external_record_id='210'))),2,'AC-OSP-001 resolved pairs exist');
select is((select count(*)::int from erp_connect_proposals where id in ('a8700000-0000-0000-0000-000000000061','a8700000-0000-0000-0000-000000000062') and state='applied' and outcome='link'),2,'AC-OSP-001 resolved reviews are closed');
select is((select state from erp_connect_proposals where id='a8700000-0000-0000-0000-000000000063'),'open','AC-OSP-006 conflict leaves review open');
select is((select state from erp_connect_proposals where id='a8700000-0000-0000-0000-000000000064'),'dismissed','AC-OSP-001 dismissal closes review');
select is((select count(*)::int from external_refs where org_id='a8700000-0000-0000-0000-000000000001' and pmo_record_id='a8700000-0000-0000-0000-000000000017'),0,'AC-OSP-001 dismissal creates no link');

select * from finish();
rollback;

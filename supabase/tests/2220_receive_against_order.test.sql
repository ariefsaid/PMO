begin;
create extension if not exists pgtap;
select * from no_plan();
select has_table('public', 'order_stock_mappings', 'AC-RGO-002 purchasing maps order lines to stock');
select has_table('public', 'order_receiving_settings', 'AC-RGO-001 receiving is opt-in');
select has_function('public', 'receive_order_goods', array['uuid','uuid','date','jsonb','uuid'], 'AC-RGO-005 order-derived stock receipt');
select has_function('public', 'read_order_receiving', array['uuid'], 'AC-RGO-004 blind receiving read');
create function pg_temp.rid(n int) returns uuid language sql immutable as $$select ('22200000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
insert into organizations(id,name,default_currency,default_timezone,built_in_roles_enabled) values
 (pg_temp.rid(1),'Receiving test','IDR','UTC',true),(pg_temp.rid(2),'Receiving other','IDR','UTC',true);
insert into auth.users(id,email) select pg_temp.rid(n),'receive-test-'||n||'@example.com' from generate_series(10,13)n;
insert into profiles(id,org_id,full_name,email,role,status,built_in_role) values
 (pg_temp.rid(10),pg_temp.rid(1),'Purchaser','receive-test-10@example.com','Admin','active',null),
 (pg_temp.rid(11),pg_temp.rid(1),'Keeper','receive-test-11@example.com','Engineer','active','storekeeper'),
 (pg_temp.rid(12),pg_temp.rid(1),'Second purchaser','receive-test-12@example.com','Finance','active',null),
 (pg_temp.rid(13),pg_temp.rid(2),'Other purchaser','receive-test-13@example.com','Admin','active',null);
insert into procurements(id,org_id,title,status,currency,requested_by_id,total_value,approved_total_value,approved_by_id) values
 (pg_temp.rid(20),pg_temp.rid(1),'Goods','Ordered','USD',pg_temp.rid(11),100,100,pg_temp.rid(10)),
 (pg_temp.rid(21),pg_temp.rid(2),'Other goods','Ordered','IDR',pg_temp.rid(13),100,100,pg_temp.rid(13));
insert into procurement_items(id,org_id,procurement_id,name,quantity,rate) values
 (pg_temp.rid(30),pg_temp.rid(1),pg_temp.rid(20),'Counted goods',10,2),
 (pg_temp.rid(31),pg_temp.rid(1),pg_temp.rid(20),'Service',1,1),
 (pg_temp.rid(32),pg_temp.rid(2),pg_temp.rid(21),'Other line',10,2);
insert into purchase_orders(id,org_id,procurement_id,po_number,status,currency) values
 (pg_temp.rid(40),pg_temp.rid(1),pg_temp.rid(20),'PO-TEST','Issued','USD'),
 (pg_temp.rid(41),pg_temp.rid(2),pg_temp.rid(21),'PO-OTHER','Issued','IDR');
insert into stock_units(id,org_id,code,name) values(pg_temp.rid(50),pg_temp.rid(1),'pc','Piece'),(pg_temp.rid(51),pg_temp.rid(2),'pc','Piece');
insert into stock_items(id,org_id,code,name,unit_id) values
 (pg_temp.rid(60),pg_temp.rid(1),'GOODS','Goods',pg_temp.rid(50)),(pg_temp.rid(61),pg_temp.rid(2),'OTHER','Other',pg_temp.rid(51));
insert into stock_warehouses(id,org_id,code,name,kind) values(pg_temp.rid(70),pg_temp.rid(1),'WH','Warehouse','central');
insert into stock_warehouse_keepers(org_id,warehouse_id,user_id) values(pg_temp.rid(1),pg_temp.rid(70),pg_temp.rid(11));
create function pg_temp.actor(n int) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rid(n),'role','authenticated')::text,true)$$;
create function pg_temp.lines(q numeric) returns jsonb language sql as $$select jsonb_build_array(jsonb_build_object('item_id',pg_temp.rid(30),'quantity',q))$$;
create function pg_temp.receive(q numeric,k int) returns jsonb language sql as $$select public.receive_order_goods(pg_temp.rid(40),pg_temp.rid(70),current_date,pg_temp.lines(q),pg_temp.rid(k))$$;
select pg_temp.actor(10);
set local role authenticated;
select is(get_order_receiving_enabled(),false,'AC-RGO-001 existing organisation defaults off');
select lives_ok($$select set_order_receiving_enabled(true)$$,'AC-RGO-001 Admin enables native receiving');
select lives_ok($$select map_order_stock(pg_temp.rid(30),pg_temp.rid(60))$$,'AC-RGO-002 purchasing maps the stock item');
select throws_ok($$select map_order_stock(pg_temp.rid(31),pg_temp.rid(61))$$,'23514',null,'AC-RGO-002 cross-org stock mapping refused');
reset role;
select pg_temp.actor(11);
set local role authenticated;
select throws_ok($$select map_order_stock(pg_temp.rid(30),pg_temp.rid(60))$$,'42501',null,'AC-RGO-002 receiver cannot set or alter mapping');
select is((select count(*)::int from procurement_items where procurement_id=pg_temp.rid(20)),0,'AC-RGO-004 raw ordered lines hidden even on own request');
select is((select count(*)::int from procurement_items_masked where procurement_id=pg_temp.rid(20)),0,'AC-RGO-004 masked ordered lines hidden');
select is((read_order_receiving(pg_temp.rid(40))->'lines'->0 ?| array['ordered','outstanding','rate','price']),false,'AC-RGO-004 receiving read omits ordered, outstanding and prices');
select throws_ok($$select get_bill_match(pg_temp.rid(99))$$,'42501',null,'AC-RGO-004 bill match reader refuses storekeeper');
select throws_ok($$select pg_temp.receive(4,80)$$,'23514','No exchange rate for USD/IDR on '||current_date||'.','AC-RGO-006 missing exchange rate names pair/date');
reset role;
select is((select count(*)::int from order_receiving_requests),0,'AC-RGO-006 missing rate leaves no partial receipt');
insert into fx_rates(org_id,source,base_currency,quote_currency,rate_date,rate) values(pg_temp.rid(1),'JISDOR','USD','IDR',current_date-1,15000);
select pg_temp.actor(11);
set local role authenticated;
select is(pg_temp.receive(4,80)->>'status','posted','AC-RGO-005 keeper posts without price');
select is(pg_temp.receive(4,80)->>'status','posted','AC-RGO-005 retry is idempotent');
select throws_ok($$select pg_temp.receive(3,80)$$,'23505',null,'AC-RGO-005 retry cannot change counted lines');
select is(pg_temp.receive(7,81)->>'status','awaiting_approval','AC-RGO-008 excess does not post without approval');
select throws_ok($$select approve_order_receiving(pg_temp.rid(81),'Count accepted')$$,'42501',null,'AC-RGO-008 receiver cannot approve own excess');
select throws_ok($$select receive_order_goods(pg_temp.rid(41),pg_temp.rid(70),current_date,pg_temp.lines(1),pg_temp.rid(82))$$,'P0002',null,'AC-RGO-011 receiver cannot receive another organisation order');
reset role;
select is((select qty_on_hand::numeric from stock_balances where item_id=pg_temp.rid(60)),4::numeric,'AC-RGO-008 excess adds no stock');
select is((select value_on_hand::numeric from stock_balances where item_id=pg_temp.rid(60)),120000::numeric,'AC-RGO-005 count times order cost times receipt-date FX');
select is((select fx_rate from order_receiving_requests where id=pg_temp.rid(80)),15000::numeric,'AC-RGO-005 receipt snapshots rate');
select is((select fx_date from order_receiving_requests where id=pg_temp.rid(80)),current_date-1,'AC-RGO-005 receipt snapshots publication day');
select is((select count(*)::int from procurement_receipt_lines where item_id=pg_temp.rid(30)),1,'AC-RGO-009 new receipt enters match lines exactly once');
select pg_temp.actor(10);
set local role authenticated;
select is(read_order_receiving(pg_temp.rid(40))->'lines'->0->>'outstanding','6.000','AC-RGO-007 purchasing sees outstanding');
select is(read_order_receiving(pg_temp.rid(40))->'lines'->0->>'status','partly_received','AC-RGO-007 partial receipt status');
select throws_ok($$select map_order_stock(pg_temp.rid(30),pg_temp.rid(60))$$,'23514',null,'AC-RGO-003 receipt freezes mapping');
select lives_ok($$select approve_order_receiving(pg_temp.rid(81),'Extra goods accepted')$$,'AC-RGO-008 different purchaser approves exact count');
reset role;
select pg_temp.actor(11);
set local role authenticated;
select is(pg_temp.receive(7,81)->>'status','posted','AC-RGO-008 receiver posts approved excess');
reset role;
select is((select qty_on_hand::numeric from stock_balances where item_id=pg_temp.rid(60)),11::numeric,'AC-RGO-008 only approved quantity enters stock');
select throws_ok($$update procurement_receipt_lines set quantity=1 where receipt_id=(select receipt_id from order_receiving_requests where id=pg_temp.rid(80))$$,'23514',null,'AC-RGO-010 receipt lines cannot be edited');
select throws_ok($$delete from procurement_receipts where id=(select receipt_id from order_receiving_requests where id=pg_temp.rid(80))$$,'23514',null,'AC-RGO-010 original receipt cannot be deleted');
select pg_temp.actor(10);
set local role authenticated;
select lives_ok($$select reverse_order_receiving(pg_temp.rid(80),'Correction of count')$$,'AC-RGO-010 reverse by a new movement');
select is(read_order_receiving(pg_temp.rid(40))->'lines'->0->>'received','7.000','AC-RGO-010 reversal reduces received without editing history');
reset role;
select is((select qty_on_hand::numeric from stock_balances where item_id=pg_temp.rid(60)),7::numeric,'AC-RGO-010 reversal adjusts stock');
select is((select quantity::numeric from procurement_receipt_lines where receipt_id=(select receipt_id from order_receiving_requests where id=pg_temp.rid(80))),4::numeric,'AC-RGO-010 reversal preserves original count');
select pg_temp.actor(13);
set local role authenticated;
select throws_ok($$select read_order_receiving(pg_temp.rid(40))$$,'P0002',null,'AC-RGO-011 other organisation cannot read counts');
select throws_ok($$select approve_order_receiving(pg_temp.rid(81),'Other')$$,'P0002',null,'AC-RGO-011 other organisation cannot approve counts');
select throws_ok($$select map_order_stock(pg_temp.rid(30),pg_temp.rid(61))$$,'P0002',null,'AC-RGO-011 other organisation cannot map lines');
reset role;
insert into external_domain_ownership(org_id,external_tier,domain) values(pg_temp.rid(2),'erpnext','procurement');
select pg_temp.actor(13);
set local role authenticated;
select throws_ok($$select set_order_receiving_enabled(true)$$,'23514',null,'AC-RGO-001 ERP procurement refuses enablement');
reset role;
delete from external_domain_ownership where org_id=pg_temp.rid(2);
insert into external_domain_ownership(org_id,external_tier,domain) values(pg_temp.rid(2),'odoo','inventory');
set local role authenticated;
select throws_ok($$select set_order_receiving_enabled(true)$$,'23514',null,'AC-RGO-001 ERP inventory refuses enablement');
reset role;
select * from finish();
rollback;

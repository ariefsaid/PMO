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
 (pg_temp.rid(21),pg_temp.rid(2),'Other goods','Ordered','IDR',pg_temp.rid(13),100,100,pg_temp.rid(13)),
 (pg_temp.rid(22),pg_temp.rid(1),'Draft request','Draft','IDR',pg_temp.rid(11),10,null,null);
insert into procurement_items(id,org_id,procurement_id,name,quantity,rate) values
 (pg_temp.rid(30),pg_temp.rid(1),pg_temp.rid(20),'Counted goods',10,2),
 (pg_temp.rid(31),pg_temp.rid(1),pg_temp.rid(20),'Service',1,1),
 (pg_temp.rid(32),pg_temp.rid(2),pg_temp.rid(21),'Other line',10,2),
 (pg_temp.rid(33),pg_temp.rid(1),pg_temp.rid(22),'Own draft line',5,2);
insert into purchase_orders(id,org_id,procurement_id,po_number,status,currency) values
 (pg_temp.rid(40),pg_temp.rid(1),pg_temp.rid(20),'PO-TEST','Issued','USD'),
 (pg_temp.rid(41),pg_temp.rid(2),pg_temp.rid(21),'PO-OTHER','Issued','IDR');
insert into stock_units(id,org_id,code,name) values(pg_temp.rid(50),pg_temp.rid(1),'pc','Piece'),(pg_temp.rid(51),pg_temp.rid(2),'pc','Piece');
insert into stock_items(id,org_id,code,name,unit_id) values
 (pg_temp.rid(60),pg_temp.rid(1),'GOODS','Goods',pg_temp.rid(50)),(pg_temp.rid(61),pg_temp.rid(2),'OTHER','Other',pg_temp.rid(51));
insert into stock_warehouses(id,org_id,code,name,kind) values(pg_temp.rid(70),pg_temp.rid(1),'WH','Warehouse','central'),(pg_temp.rid(71),pg_temp.rid(2),'WH','Other warehouse','central');
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
select throws_ok($$select set_order_receiving_enabled(false)$$,'42501',null,'AC-RGO-001 receiver cannot change organisation receiving settings');
select is((select count(*)::int from procurement_items where procurement_id=pg_temp.rid(20)),0,'AC-RGO-004 raw ordered lines hidden even on own request');
select is((select count(*)::int from procurement_items_masked where procurement_id=pg_temp.rid(20)),0,'AC-RGO-004 masked ordered lines hidden');
select is((select count(*)::int from procurement_items where procurement_id=pg_temp.rid(22)),1,'AC-RGO-004 keeper retains own draft request authoring');
select is((read_order_receiving(pg_temp.rid(40))->'lines'->0 ?| array['ordered','outstanding','rate','price']),false,'AC-RGO-004 receiving read omits ordered, outstanding and prices');
select throws_ok($$select get_bill_match(pg_temp.rid(99))$$,'42501',null,'AC-RGO-004 bill match reader refuses storekeeper');
select is(actor_may_see_prices_now(),false,'AC-RGO-004 blind receiving also hides stock valuation when the general price setting is off');
select throws_ok($$select extend_rental_procurement(pg_temp.rid(95),pg_temp.rid(20),current_date,current_date+1)$$,
 '42501','RGO_BLIND_COPY: Enter your own request quantities; a blind receiver cannot copy ordered quantities.',
 'AC-RGO-004 blind receiver cannot copy ordered quantities through the granted extension function');
select is(has_table_privilege('authenticated','public.order_stock_mappings','INSERT'),false,'AC-RGO-002 receiver has no direct mapping insert grant');
select is(has_table_privilege('authenticated','public.order_receiving_requests','UPDATE'),false,'AC-RGO-008 receiver cannot write approval witnesses directly');
select throws_ok($$select pg_temp.receive(4,80)$$,'23514','RGO_FX_MISSING: No exchange rate for USD/IDR on '||current_date||'.','AC-RGO-006 missing exchange rate names pair/date');
reset role;
select is((select count(*)::int from order_receiving_requests),0,'AC-RGO-006 missing rate leaves no partial receipt');
insert into fx_rates(org_id,source,base_currency,quote_currency,rate_date,rate) values(pg_temp.rid(1),'JISDOR','USD','IDR',current_date-1,15000);
select pg_temp.actor(11);
set local role authenticated;
select is(pg_temp.receive(4,80)->>'status','posted','AC-RGO-005 keeper posts without price');
select is(pg_temp.receive(4,80)->>'status','posted','AC-RGO-005 retry is idempotent');
select throws_ok($$select pg_temp.receive(3,80)$$,'23505',null,'AC-RGO-005 retry cannot change counted lines');
select is(pg_temp.receive(7,81)->>'status','awaiting_approval','AC-RGO-008 excess does not post without approval');
select is((select count(*)::int from my_waiting_decisions() where kind='order_receiving'),0,'AC-RGO-008 receiver has no own excess approval in inbox');
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
select is((select count(*)::int from my_waiting_decisions() where kind='order_receiving' and record_id=pg_temp.rid(40)),1,'AC-RGO-008 excess order appears in purchasing inbox');
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
select pg_temp.actor(10);
set local role authenticated;
select lives_ok($$select set_three_way_match_settings(true,0,0)$$,'AC-RGO-009 matching is enabled without changing the receiving rule');
select set_config('rgo.bill',(create_procurement_invoice(p_procurement_id=>pg_temp.rid(20),p_status=>'Received',p_invoice_date=>current_date,p_amount=>20,p_tax_treatment=>'exclusive',p_tax_amount=>0)).id::text,true);
select lives_ok($$select record_bill_match_lines(current_setting('rgo.bill')::uuid,jsonb_build_array(jsonb_build_object('item_id',pg_temp.rid(30),'quantity',10,'rate',2)))$$,'AC-RGO-009 bill records the order-currency line');
select is(get_bill_match(current_setting('rgo.bill')::uuid)->>'status','matched','AC-RGO-009 bill matches the counted receipts in purchase currency');
reset role;
select throws_ok($$update procurement_receipt_lines set quantity=1 where receipt_id=(select receipt_id from order_receiving_requests where id=pg_temp.rid(80))$$,'23514',null,'AC-RGO-010 receipt lines cannot be edited');
select throws_ok($$delete from procurement_receipts where id=(select receipt_id from order_receiving_requests where id=pg_temp.rid(80))$$,'23514',null,'AC-RGO-010 original receipt cannot be deleted');
select pg_temp.actor(10);
set local role authenticated;
select lives_ok($$select reverse_order_receiving(pg_temp.rid(80),'Correction of count')$$,'AC-RGO-010 reverse by a new movement');
select is(read_order_receiving(pg_temp.rid(40))->'lines'->0->>'received','7.000','AC-RGO-010 reversal reduces received without editing history');
select is(get_bill_match(current_setting('rgo.bill')::uuid)->>'status','held','AC-RGO-009 reversal removes the original quantity from bill matching');
reset role;
select is((select qty_on_hand::numeric from stock_balances where item_id=pg_temp.rid(60)),7::numeric,'AC-RGO-010 reversal adjusts stock');
select is((select quantity::numeric from procurement_receipt_lines where receipt_id=(select receipt_id from order_receiving_requests where id=pg_temp.rid(80))),4::numeric,'AC-RGO-010 reversal preserves original count');
select pg_temp.actor(13);
set local role authenticated;
select throws_ok($$select read_order_receiving(pg_temp.rid(40))$$,'P0002',null,'AC-RGO-011 other organisation cannot read counts');
select throws_ok($$select approve_order_receiving(pg_temp.rid(81),'Other')$$,'P0002',null,'AC-RGO-011 other organisation cannot approve counts');
select throws_ok($$select map_order_stock(pg_temp.rid(30),pg_temp.rid(61))$$,'P0002',null,'AC-RGO-011 other organisation cannot map lines');
select lives_ok($$select set_order_receiving_enabled(true)$$,'AC-RGO-001 native second organisation enables receiving');
select lives_ok($$select map_order_stock(pg_temp.rid(32),pg_temp.rid(61))$$,'AC-RGO-002 native second organisation maps its own line');
select is(receive_order_goods(pg_temp.rid(41),pg_temp.rid(71),current_date,jsonb_build_array(jsonb_build_object('item_id',pg_temp.rid(32),'quantity','2')),pg_temp.rid(83))->>'status','posted','AC-RGO-005 same-currency receipt needs no exchange-rate row');
select lives_ok($$select set_order_receiving_enabled(false)$$,'AC-RGO-001 Admin can switch back to the existing receiving path');
reset role;
select is((select fx_rate from order_receiving_requests where id=pg_temp.rid(83)),1::numeric,'AC-RGO-005 same currency snapshots rate one');
select is((select value_on_hand::numeric from stock_balances where item_id=pg_temp.rid(61)),4::numeric,'AC-RGO-005 same-currency stock value equals quantity times order rate');
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

-- Mutation probes evaluate the same behaviour oracle before and after breaking the rule.
-- Each probe rolls its DDL and all writes back in a subtransaction; an unchanged or broken baseline fails the proof.
create function pg_temp.allowed(n int,stmt text) returns boolean language plpgsql as $$
begin
 perform pg_temp.actor(n); execute 'set local role authenticated'; execute stmt; execute 'reset role'; return true;
exception when others then execute 'reset role'; return false;
end $$;
create function pg_temp.value(n int,stmt text) returns text language plpgsql as $$
declare result text;
begin
 perform pg_temp.actor(n); execute 'set local role authenticated'; execute stmt into result; execute 'reset role'; return result;
exception when others then execute 'reset role'; return 'error';
end $$;
create function pg_temp.probe(stmt text) returns boolean language plpgsql as $$
declare result boolean;
begin
 begin execute stmt into result; raise exception using errcode='Z0001';
 exception when sqlstate 'Z0001' then null; end;
 return result;
end $$;
create function pg_temp.kill(change_sql text,oracle_sql text) returns boolean language plpgsql as $$
declare baseline boolean; changed boolean;
begin
 baseline:=pg_temp.probe(oracle_sql);
 if baseline is not true then raise exception 'Mutation oracle baseline failed: %',oracle_sql; end if;
 begin execute change_sql; changed:=pg_temp.probe(oracle_sql); raise exception using errcode='Z0001';
 exception when sqlstate 'Z0001' then null; end;
 return changed is false;
end $$;
create function pg_temp.mutation(sig text,old_text text,new_text text,oracle_sql text) returns boolean language plpgsql as $$
declare original text; changed text;
begin
 select pg_get_functiondef(sig::regprocedure) into original;
 changed:=replace(original,old_text,new_text);
 if changed=original then raise exception 'Mutation target missing in %',sig; end if;
 return pg_temp.kill(changed,oracle_sql);
end $$;
create function pg_temp.cost_oracle() returns boolean language plpgsql as $$
declare result boolean;
begin
 perform pg_temp.actor(11); execute 'set local role authenticated'; perform pg_temp.receive(1,90); execute 'reset role';
 select sum(value_delta)=30000 into result from stock_ledger where document_id=(select stock_document_id from order_receiving_requests where id=pg_temp.rid(90));
 return result;
end $$;
select ok(pg_temp.mutation('public.map_order_stock(uuid,uuid)',
 'if not public.order_receiving_purchaser() then','if false then',
 $$select not pg_temp.allowed(11,'select map_order_stock(pg_temp.rid(31),pg_temp.rid(60))')$$),
 'AC-RGO-002 mutation: removing mapping authority makes the owning refusal oracle fail');
select ok(pg_temp.mutation('public.map_order_stock(uuid,uuid)',
 'i.id = p_item and i.org_id = v_org','i.id = p_item',
 $$select not pg_temp.allowed(13,'select map_order_stock(pg_temp.rid(31),pg_temp.rid(61))')$$),
 'AC-RGO-011 mutation: removing mapping tenancy makes the owning refusal oracle fail');
select ok(pg_temp.mutation('public.set_order_receiving_enabled(boolean)',
 $$if public.auth_role() is distinct from 'Admin' then$$,'if false then',
 $$select not pg_temp.allowed(11,'select set_order_receiving_enabled(false)')$$),
 'AC-RGO-001 mutation: removing Admin authority fails the setting refusal oracle');
select ok(pg_temp.mutation('public.guard_order_receiving_setting()',
 $q$raise exception 'RGO_EXTERNAL: Receiving against an order requires PMO to own purchasing and inventory. Continue receiving in your accounting system.' using errcode = '23514';$q$,'null;',
 $$select not pg_temp.allowed(13,'select set_order_receiving_enabled(true)')$$),
 'AC-RGO-001 mutation: removing ownership guard fails the ERP enablement refusal oracle');
select ok(pg_temp.mutation('public.receive_order_goods(uuid,uuid,date,jsonb,uuid)',
 'round(v_item.rate * v_fx,4)','round(0 * v_fx,4)',
 $$select pg_temp.cost_oracle()$$),'AC-RGO-005 mutation: ignoring order price fails the stock value oracle');
select ok(pg_temp.mutation('public.receive_order_goods(uuid,uuid,date,jsonb,uuid)',
 'round(v_item.rate * v_fx,4)','round(v_item.rate * 1,4)',
 $$select pg_temp.cost_oracle()$$),'AC-RGO-005 mutation: ignoring FX fails the stock value oracle');
create function pg_temp.missing_fx_oracle() returns boolean language plpgsql as $$
begin
 delete from public.fx_rates where org_id=pg_temp.rid(1);
 return not pg_temp.allowed(11,'select pg_temp.receive(1,94)');
end $$;
select ok(pg_temp.mutation('public.receive_order_goods(uuid,uuid,date,jsonb,uuid)',
 'if v_fx is null then','if v_fx is null then v_fx:=1; v_fx_date:=p_date; end if; if false then',
 $$select pg_temp.missing_fx_oracle()$$),'AC-RGO-006 mutation: substituting rate one fails the missing-rate refusal oracle');
select ok(pg_temp.mutation('public.receive_order_goods(uuid,uuid,date,jsonb,uuid)',
 'if v_excess and v_r.approved_by is null then','if false then',
 $$select pg_temp.value(11,$q$select pg_temp.receive(20,91)->>'status'$q$)='awaiting_approval'$$),
 'AC-RGO-008 mutation: bypassing excess approval fails the pending-count oracle');
select ok(pg_temp.mutation('public.read_order_receiving(uuid)',
 'case when v_purchaser then jsonb_build_object','case when true then jsonb_build_object',
 $$select pg_temp.value(11,$q$select read_order_receiving(pg_temp.rid(40))->'lines'->0 ? 'ordered'$q$)='false'$$),
 'AC-RGO-004 mutation: exposing ordered count fails the blind-read oracle');
select ok(pg_temp.kill('alter policy receiving_blind_lines on public.procurement_items using(true)',
 $$select pg_temp.value(11,$q$select count(*) from procurement_items where procurement_id=pg_temp.rid(20)$q$)='0'$$),
 'AC-RGO-004 mutation: opening raw ordered-line policy fails the blind table oracle');
select ok(pg_temp.mutation('public.map_order_stock(uuid,uuid)',
 $q$raise exception 'RGO_MAPPING_FROZEN: This line has a receipt count; its stock item cannot change.' using errcode = '23514';$q$,'null;',
 $$select not pg_temp.allowed(10,'select map_order_stock(pg_temp.rid(30),null)')$$),
 'AC-RGO-003 mutation: allowing remapping fails the frozen mapping oracle');
select ok(pg_temp.mutation('public.guard_order_receipt_immutable()',
 $q$raise exception 'RGO_IMMUTABLE: An order receipt is immutable; record a reversing movement.' using errcode='23514';$q$,'null;',
 $$select not pg_temp.allowed(10,format('select record_receipt_match_lines(%L,%L::jsonb)',(select receipt_id from order_receiving_requests where id=pg_temp.rid(80)),pg_temp.lines(1)))$$),
 'AC-RGO-010 mutation: removing immutability fails the receipt edit oracle');
select ok(pg_temp.mutation('public.bill_match_evaluate(uuid)',
 $target$         and not exists (select 1 from public.order_receiving_requests req
                           join public.order_receiving_reversals rev on rev.request_id=req.id
                          where req.receipt_id=r.id)$target$,'',
 $$select pg_temp.value(10,$q$select get_bill_match(current_setting('rgo.bill')::uuid)->>'status'$q$)='held'$$),
 'AC-RGO-009 mutation: counting a reversed receipt fails the held-bill oracle');
select pg_temp.actor(10);
set local role authenticated;
select is(pg_temp.receive(20,92)->>'status','awaiting_approval','AC-RGO-008 a purchaser who receives also needs someone else to approve');
select throws_ok($$select approve_order_receiving(pg_temp.rid(92),'My own excess')$$,'42501',null,'AC-RGO-008 purchasing rights do not permit self-approval');
reset role;
select ok(pg_temp.kill(
 replace(pg_get_functiondef('public.approve_order_receiving(uuid,text)'::regprocedure),' or r.receiver_id = auth.uid()','')
 || '; alter table public.order_receiving_requests drop constraint order_receiving_requests_check',
 $$select not pg_temp.allowed(10,'select approve_order_receiving(pg_temp.rid(92),''My own excess'')')$$),
 'AC-RGO-008 mutation: removing both self-approval defences fails the same-person oracle');
-- A different receipt can consume the remaining order quantity after an excess was reviewed.
select pg_temp.actor(11);
set local role authenticated;
select is(pg_temp.receive(5,96)->>'status','awaiting_approval','AC-RGO-008 new count waits for its excess review');
reset role;
select pg_temp.actor(10);
set local role authenticated;
select lives_ok($$select approve_order_receiving(pg_temp.rid(96),'Accept this excess')$$,'AC-RGO-008 purchaser approves the current excess');
select is(pg_temp.receive(1,97)->>'status','posted','AC-RGO-008 another receipt consumes outstanding quantity');
reset role;
select pg_temp.actor(11);
set local role authenticated;
select is(pg_temp.receive(5,96)->>'status','awaiting_approval','AC-RGO-008 increased excess requires a fresh approval');
select is((select (x->>'approved')::boolean from jsonb_array_elements(read_order_receiving(pg_temp.rid(40))->'requests') x where x->>'id'=pg_temp.rid(96)::text),false,'AC-RGO-008 stale approval is shown as waiting');
reset role;
select pg_temp.actor(10);
set local role authenticated;
select lives_ok($$select approve_order_receiving(pg_temp.rid(96),'Accept the revised excess')$$,'AC-RGO-008 purchasing can review the changed excess');
reset role;
select pg_temp.actor(11);
set local role authenticated;
select is(pg_temp.receive(5,96)->>'status','posted','AC-RGO-008 the newly approved excess posts once');
reset role;
select * from finish();
rollback;
